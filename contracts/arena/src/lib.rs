//! Proof of Done arena: agents stake NEAR to bid on a coding bounty, the lowest ask gets the job,
//! and saying "done" is a bet. If the client's hidden tests fail, the whole stake is slashed.
//! Giving up honestly before claiming costs 20%. Slashed stake never goes to the client: it is
//! added to the bounty and paid to the agent whose work actually passes (or returned on cancel),
//! so a client gains nothing by failing good work. A client can still fail good work to steer the
//! pot to a second account it controls; naming an independent verifier when posting takes the
//! verdict out of the client's hands.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::IterableMap;
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, near, require};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Bounties,
    Agents,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    /// Accepting bids.
    Bidding,
    /// The lowest bidder has the job and has not claimed yet.
    Assigned,
    /// The worker said "done"; waiting for the client's verdict.
    Claimed,
    Paid,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Bid {
    pub agent: AccountId,
    pub ask: U128,
    pub stake: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Claim {
    /// "sha256:<hex>" of the patch
    pub patch: String,
    /// "sha256:<hex>" of the agent's trace (commands run, test output). Optional evidence.
    pub trace: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Bounty {
    pub id: u64,
    pub client: AccountId,
    pub title: String,
    pub spec: String,
    /// "sha256:<hex>" of the hidden tests, committed before any bid so they cannot change later.
    pub tests_hash: String,
    /// Result of running a no-op patch against the hidden tests before posting, e.g. "noop: 1/8 pass".
    pub grader_check: String,
    pub reward: U128,
    pub min_stake: U128,
    pub status: Status,
    /// Open bids, not including the current worker's.
    pub bids: Vec<Bid>,
    pub worker: Option<Bid>,
    pub assigned_at_ns: u64,
    pub claim: Option<Claim>,
    /// Slashed stake waiting for the agent that ships. (agent, amount) so it can be refunded on cancel.
    pub pot: Vec<(AccountId, U128)>,
    /// One line per event, human readable.
    pub log: Vec<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct AgentStats {
    pub bids: u32,
    pub assigned: u32,
    pub paid: u32,
    pub false_claims: u32,
    pub abandoned: u32,
    pub earned: U128,
    pub slashed: U128,
}

#[near(serializers = [json])]
pub struct Standing {
    pub agent: AccountId,
    pub stats: AgentStats,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    bounties: IterableMap<u64, Bounty>,
    agents: IterableMap<AccountId, AgentStats>,
    next_id: u64,
    /// How long a worker has to claim before anyone can expire the assignment.
    claim_window_ns: u64,
}

pub const ABANDON_FEE_PCT: u128 = 20;
/// Bids a bounty accepts over its whole life, withdrawn ones included. Each can leave a pot entry
/// and a new leaderboard row, so this bounds what a bounty can grow to, and `storage_fee` charges
/// the client for all of it upfront.
const MAX_BIDS: u32 = 20;
const MAX_LOG: usize = 20;
const MAX_LINE: usize = 300;
/// Record and index overhead, verifier and claim keys, worker and claim fields.
const BASE_BYTES: u64 = 1000;
/// One bid, later a pot entry (account, two U128), plus a new leaderboard row with its key.
const ENTRY_BYTES: u64 = 300;
const GROWTH_BYTES: u64 = MAX_BIDS as u64 * ENTRY_BYTES + MAX_LOG as u64 * (4 + MAX_LINE as u64);
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "proof-of-done", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

/// Every transfer is followed by `on_transfer`; if it fails (say the account was deleted after
/// bidding), the NEAR comes back to the arena and is booked as owed to that account.
fn pay(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(yocto))
            .then(Arena::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_transfer(to.clone(), U128(yocto)))
            .detach();
    }
}

/// Merge payments to the same account so a settlement makes one transfer per account.
fn pay_all(payments: Vec<(AccountId, u128)>) {
    let mut merged: Vec<(AccountId, u128)> = vec![];
    for (to, yocto) in payments {
        match merged.iter_mut().find(|(a, _)| *a == to) {
            Some(m) => m.1 += yocto,
            None => merged.push((to, yocto)),
        }
    }
    for (to, yocto) in merged {
        pay(&to, yocto);
    }
}

fn owed_key(account: &AccountId) -> Vec<u8> {
    [b"owed:".as_slice(), account.as_bytes()].concat()
}

fn owed_of(account: &AccountId) -> u128 {
    env::storage_read(&owed_key(account)).map(|v| u128::from_le_bytes(v.try_into().unwrap())).unwrap_or(0)
}

/// Verifiers live under their own storage keys, outside `Bounty`, so arenas deployed before this
/// field existed keep reading their state.
fn verifier_key(id: u64) -> Vec<u8> {
    [b"verifier:".as_slice(), &id.to_le_bytes()].concat()
}

/// When the worker claimed, also under its own key so older arenas keep reading their state.
fn claimed_at_key(id: u64) -> Vec<u8> {
    [b"claimed_at:".as_slice(), &id.to_le_bytes()].concat()
}

/// Bids ever placed on a bounty, under its own key so older arenas keep reading their state.
fn bid_count_key(id: u64) -> Vec<u8> {
    [b"bid_count:".as_slice(), &id.to_le_bytes()].concat()
}

/// Set when an account withdraws from a bounty; withdrawing is free, so it is final for that bounty.
fn withdrew_key(id: u64, agent: &AccountId) -> Vec<u8> {
    [b"withdrew:".as_slice(), &id.to_le_bytes(), agent.as_bytes()].concat()
}

fn verifier_of(id: u64) -> Option<AccountId> {
    env::storage_read(&verifier_key(id)).and_then(|v| String::from_utf8(v).ok()).and_then(|s| s.parse().ok())
}

fn near_str(yocto: u128) -> String {
    let milli = yocto / 10u128.pow(21);
    format!("{}.{:03} NEAR", milli / 1000, milli % 1000)
}

#[near]
impl Arena {
    #[init]
    pub fn new(claim_window_minutes: Option<u64>) -> Self {
        Self {
            bounties: IterableMap::new(StorageKey::Bounties),
            agents: IterableMap::new(StorageKey::Agents),
            next_id: 0,
            claim_window_ns: claim_window_minutes.unwrap_or(60) * 60 * 1_000_000_000,
        }
    }

    /// Lock the attached deposit as the reward. The worker is paid their ask; the rest returns.
    /// `verifier`, if set, is the only account that can give the verdict and cannot bid.
    #[payable]
    pub fn post_bounty(&mut self, title: String, spec: String, tests_hash: String, grader_check: String, min_stake: U128, verifier: Option<AccountId>) -> Bounty {
        require!(min_stake.0 > 0, "min_stake must be positive");
        require!(title.len() <= 120 && spec.len() <= 1000 && grader_check.len() <= 200, "text too long");
        require!(tests_hash.starts_with("sha256:") && tests_hash.len() == 71, "tests_hash must be sha256:<64 hex>");
        let client = env::predecessor_account_id();
        let fee = self.storage_fee(client.clone(), title.clone(), spec.clone(), grader_check.clone()).0;
        let reward = env::attached_deposit().as_yoctonear().saturating_sub(fee);
        require!(reward >= NearToken::from_millinear(10).as_yoctonear(), "reward after the storage fee must be at least 0.01 NEAR");
        require!(verifier.as_ref() != Some(&client), "the verifier must not be the client");
        let mut b = Bounty {
            id: self.next_id,
            client: client.clone(),
            title,
            spec,
            tests_hash,
            grader_check,
            reward: U128(reward),
            min_stake,
            status: Status::Bidding,
            bids: vec![],
            worker: None,
            assigned_at_ns: 0,
            claim: None,
            pot: vec![],
            log: vec![format!("{client} posted {} (min stake {}, storage fee {})", near_str(reward), near_str(min_stake.0), near_str(fee))],
        };
        self.next_id += 1;
        if let Some(v) = &verifier {
            env::storage_write(&verifier_key(b.id), v.as_bytes());
            Self::note(&mut b, format!("verdicts by {v}, not the client"));
        }
        self.bounties.insert(b.id, b.clone());
        emit("bounty_posted", json!({"id": b.id, "client": client, "reward": b.reward, "verifier": verifier}));
        b
    }

    /// Attach the stake. `ask` is what you want to be paid; it cannot exceed the reward.
    #[payable]
    pub fn bid(&mut self, id: u64, ask: U128) -> Bounty {
        let agent = env::predecessor_account_id();
        let stake = env::attached_deposit().as_yoctonear();
        let mut b = self.get(id);
        require!(b.status == Status::Bidding || b.status == Status::Assigned || b.status == Status::Claimed, "bounty is closed");
        require!(agent != b.client, "the client cannot bid on its own bounty");
        require!(verifier_of(id).as_ref() != Some(&agent), "the verifier cannot bid on the bounty it judges");
        require!(stake >= b.min_stake.0, format!("stake must be at least {}", near_str(b.min_stake.0)));
        require!(ask.0 > 0 && ask.0 <= b.reward.0, format!("ask must be between 0 and the reward ({})", near_str(b.reward.0)));
        require!(
            !b.bids.iter().any(|x| x.agent == agent) && b.worker.as_ref().is_none_or(|w| w.agent != agent),
            "one bid per agent"
        );
        require!(!env::storage_has_key(&withdrew_key(id, &agent)), "you withdrew from this bounty");
        let count = env::storage_read(&bid_count_key(id)).map(|v| u32::from_le_bytes(v.try_into().unwrap())).unwrap_or(0);
        require!(count < MAX_BIDS, format!("bounty is full: {MAX_BIDS} bids over its life"));
        env::storage_write(&bid_count_key(id), &(count + 1).to_le_bytes());
        b.bids.push(Bid { agent: agent.clone(), ask, stake: U128(stake) });
        Self::note(&mut b, format!("{agent} bid {} with {} stake", near_str(ask.0), near_str(stake)));
        self.stats(&agent, |s| s.bids += 1);
        self.bounties.insert(id, b.clone());
        emit("bid", json!({"id": id, "agent": agent, "ask": ask, "stake": U128(stake)}));
        b
    }

    /// A bidder who is not the current worker can leave and get the full stake back, once: it
    /// cannot bid on this bounty again, so one account cannot use up the bounty's lifetime bids.
    pub fn withdraw_bid(&mut self, id: u64) -> Bounty {
        let agent = env::predecessor_account_id();
        let mut b = self.get(id);
        let i = b.bids.iter().position(|x| x.agent == agent).unwrap_or_else(|| env::panic_str("no open bid from you"));
        let bid = b.bids.remove(i);
        env::storage_write(&withdrew_key(id, &agent), &[1]);
        pay(&agent, bid.stake.0);
        Self::note(&mut b, format!("{agent} withdrew its bid"));
        self.bounties.insert(id, b.clone());
        b
    }

    /// Client stops bidding; the lowest ask gets the job (earliest bid wins ties).
    pub fn close_bidding(&mut self, id: u64) -> Bounty {
        let mut b = self.get(id);
        require!(env::predecessor_account_id() == b.client, "only the client can close bidding");
        require!(b.status == Status::Bidding, "bidding is not open");
        require!(!b.bids.is_empty(), "no bids yet");
        self.assign_next(&mut b);
        self.bounties.insert(id, b.clone());
        b
    }

    /// The worker says the work is done. From here the stake rides on the hidden tests.
    pub fn claim_done(&mut self, id: u64, patch: String, trace: String) -> Bounty {
        let agent = env::predecessor_account_id();
        let mut b = self.get(id);
        require!(b.status == Status::Assigned, "nothing to claim");
        require!(b.worker.as_ref().is_some_and(|w| w.agent == agent), "you are not the worker");
        require!(patch.len() <= 80 && trace.len() <= 80, "hash too long");
        b.claim = Some(Claim { patch: patch.clone(), trace });
        b.status = Status::Claimed;
        env::storage_write(&claimed_at_key(id), &env::block_timestamp().to_le_bytes());
        Self::note(&mut b, format!("{agent} claimed done ({patch})"));
        self.bounties.insert(id, b.clone());
        emit("claimed", json!({"id": id, "agent": agent}));
        b
    }

    /// The worker gives up before claiming: 80% of the stake back, 20% to the pot.
    pub fn abandon(&mut self, id: u64, reason: String) -> Bounty {
        let agent = env::predecessor_account_id();
        let mut b = self.get(id);
        require!(b.status == Status::Assigned, "can only abandon before claiming");
        require!(b.worker.as_ref().is_some_and(|w| w.agent == agent), "you are not the worker");
        require!(reason.len() <= 200, "reason too long");
        self.drop_worker(&mut b, &format!("abandoned: {reason}"));
        self.bounties.insert(id, b.clone());
        b
    }

    /// Anyone can expire a worker that sat on the job past the claim window. Same cost as abandoning.
    pub fn expire(&mut self, id: u64) -> Bounty {
        let mut b = self.get(id);
        require!(b.status == Status::Assigned, "no assignment to expire");
        require!(env::block_timestamp() > b.assigned_at_ns + self.claim_window_ns, "claim window still open");
        self.drop_worker(&mut b, "expired: no claim within the window");
        self.bounties.insert(id, b.clone());
        b
    }

    /// The verifier (or the client, if none was named) reports the hidden-test result.
    /// `evidence` should say how to re-run it.
    pub fn verdict(&mut self, id: u64, passed: bool, evidence: String) -> Bounty {
        let mut b = self.get(id);
        match verifier_of(id) {
            Some(v) => require!(env::predecessor_account_id() == v, "only the verifier can give a verdict"),
            None => require!(env::predecessor_account_id() == b.client, "only the client can give a verdict"),
        }
        require!(b.status == Status::Claimed, "no claim to judge");
        require!(evidence.len() <= 300, "evidence too long");
        env::storage_remove(&claimed_at_key(id));
        let w = b.worker.take().unwrap();
        if passed {
            self.pay_worker(id, &mut b, w, &evidence);
        } else {
            b.pot.push((w.agent.clone(), w.stake));
            self.stats(&w.agent, |s| {
                s.false_claims += 1;
                s.slashed = U128(s.slashed.0 + w.stake.0);
            });
            Self::note(&mut b, format!("FAILED: {} claimed done, slashed {}; {evidence}", w.agent, near_str(w.stake.0)));
            emit("slashed", json!({"id": id, "agent": w.agent, "amount": w.stake, "evidence": evidence}));
            b.claim = None;
            self.assign_next(&mut b);
        }
        self.bounties.insert(id, b.clone());
        b
    }

    /// Anyone can settle a claim the judge left unanswered past the claim window. The silent
    /// side is the judge, so the worker is paid as if the hidden tests passed.
    pub fn verdict_timeout(&mut self, id: u64) -> Bounty {
        let mut b = self.get(id);
        require!(b.status == Status::Claimed, "no claim to settle");
        let at = env::storage_read(&claimed_at_key(id))
            .map(|v| u64::from_le_bytes(v.try_into().unwrap()))
            .unwrap_or_else(|| env::panic_str("claim has no timestamp"));
        require!(env::block_timestamp() > at + self.claim_window_ns, "verdict window still open");
        env::storage_remove(&claimed_at_key(id));
        let w = b.worker.take().unwrap();
        self.pay_worker(id, &mut b, w, "no verdict within the window, paid by default");
        self.bounties.insert(id, b.clone());
        b
    }

    /// Client cancels while nobody holds the job: reward back to the client, every stake and
    /// every slashed amount back to its agent.
    pub fn cancel(&mut self, id: u64) -> Bounty {
        let mut b = self.get(id);
        require!(env::predecessor_account_id() == b.client, "only the client can cancel");
        require!(b.status == Status::Bidding, "can only cancel while bidding");
        let mut payments = vec![(b.client.clone(), b.reward.0)];
        payments.extend(b.bids.drain(..).map(|x| (x.agent, x.stake.0)));
        payments.extend(b.pot.drain(..).map(|(a, x)| (a, x.0)));
        pay_all(payments);
        b.status = Status::Cancelled;
        Self::note(&mut b, "cancelled by the client; all stakes returned".into());
        self.bounties.insert(id, b.clone());
        b
    }

    /// Runs after every transfer. On failure the amount is back in the arena and owed to `to`.
    #[private]
    pub fn on_transfer(&mut self, to: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if !ok {
            env::storage_write(&owed_key(&to), &(owed_of(&to) + amount.0).to_le_bytes());
            emit("transfer_failed", json!({"to": to, "amount": amount}));
        }
        ok
    }

    /// An account whose payout failed collects it here (a failed retry is owed again).
    pub fn withdraw_owed(&mut self) -> U128 {
        let me = env::predecessor_account_id();
        let amount = owed_of(&me);
        require!(amount > 0, "nothing owed to you");
        env::storage_remove(&owed_key(&me));
        pay(&me, amount);
        U128(amount)
    }

    pub fn get_owed(&self, account: AccountId) -> U128 {
        U128(owed_of(&account))
    }

    /// What `post_bounty` keeps from the deposit for the bounty's storage, at its largest:
    /// MAX_BIDS bids that each leave a pot entry with new leaderboard rows and MAX_LOG full log lines.
    pub fn storage_fee(&self, client: AccountId, title: String, spec: String, grader_check: String) -> U128 {
        let bytes = BASE_BYTES + GROWTH_BYTES + (client.len() + title.len() + spec.len() + grader_check.len()) as u64;
        U128(env::storage_byte_cost().as_yoctonear() * bytes as u128)
    }

    // --- views

    pub fn get_verifier(&self, id: u64) -> Option<AccountId> {
        verifier_of(id)
    }

    pub fn get_bounty(&self, id: u64) -> Option<Bounty> {
        self.bounties.get(&id).cloned()
    }

    pub fn list_bounties(&self) -> Vec<Bounty> {
        self.bounties.values().cloned().collect()
    }

    /// Sorted by paid, then fewest false claims.
    pub fn leaderboard(&self) -> Vec<Standing> {
        let mut v: Vec<Standing> = self
            .agents
            .iter()
            .map(|(a, s)| Standing { agent: a.clone(), stats: s.clone() })
            .collect();
        v.sort_by(|x, y| y.stats.paid.cmp(&x.stats.paid).then(x.stats.false_claims.cmp(&y.stats.false_claims)).then(y.stats.earned.0.cmp(&x.stats.earned.0)));
        v
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({"claim_window_minutes": self.claim_window_ns / 60_000_000_000, "abandon_fee_pct": ABANDON_FEE_PCT as u64, "max_bids": MAX_BIDS, "max_log": MAX_LOG})
    }

    // --- internal

    fn pay_worker(&mut self, id: u64, b: &mut Bounty, w: Bid, evidence: &str) {
        let pot: u128 = b.pot.drain(..).map(|(_, a)| a.0).sum();
        let earned = w.ask.0 + pot;
        let mut payments = vec![(w.agent.clone(), earned + w.stake.0), (b.client.clone(), b.reward.0 - w.ask.0)];
        payments.extend(b.bids.drain(..).map(|x| (x.agent, x.stake.0)));
        pay_all(payments);
        self.stats(&w.agent, |s| {
            s.paid += 1;
            s.earned = U128(s.earned.0 + earned);
        });
        b.status = Status::Paid;
        Self::note(b, format!("PASSED: {} paid {} (ask {} + pot {}); {evidence}", w.agent, near_str(earned), near_str(w.ask.0), near_str(pot)));
        emit("paid", json!({"id": id, "agent": w.agent, "earned": U128(earned), "evidence": evidence}));
    }

    fn drop_worker(&mut self, b: &mut Bounty, why: &str) {
        let w = b.worker.take().unwrap();
        let fee = w.stake.0 * ABANDON_FEE_PCT / 100;
        pay(&w.agent, w.stake.0 - fee);
        b.pot.push((w.agent.clone(), U128(fee)));
        self.stats(&w.agent, |s| {
            s.abandoned += 1;
            s.slashed = U128(s.slashed.0 + fee);
        });
        Self::note(b, format!("{} {why}; kept {}, fee {}", w.agent, near_str(w.stake.0 - fee), near_str(fee)));
        emit("abandoned", json!({"id": b.id, "agent": w.agent, "fee": U128(fee)}));
        self.assign_next(b);
    }

    fn assign_next(&mut self, b: &mut Bounty) {
        let Some(i) = b.bids.iter().enumerate().min_by_key(|(i, x)| (x.ask.0, *i)).map(|(i, _)| i) else {
            b.status = Status::Bidding;
            Self::note(b, "no bids left; bidding reopened".into());
            return;
        };
        let w = b.bids.remove(i);
        Self::note(b, format!("{} assigned at {}", w.agent, near_str(w.ask.0)));
        emit("assigned", json!({"id": b.id, "agent": w.agent, "ask": w.ask}));
        self.stats(&w.agent, |s| s.assigned += 1);
        b.worker = Some(w);
        b.assigned_at_ns = env::block_timestamp();
        b.status = Status::Assigned;
    }

    fn stats(&mut self, agent: &AccountId, f: impl FnOnce(&mut AgentStats)) {
        let mut s = self.agents.get(agent).cloned().unwrap_or_default();
        f(&mut s);
        self.agents.insert(agent.clone(), s);
    }

    /// Keeps the first line (who posted) and the newest ones; lines are cut at MAX_LINE bytes.
    fn note(b: &mut Bounty, mut line: String) {
        if line.len() > MAX_LINE {
            let mut end = MAX_LINE - 3;
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
            line.push_str("...");
        }
        while b.log.len() >= MAX_LOG {
            b.log.remove(1);
        }
        b.log.push(line);
    }

    fn get(&self, id: u64) -> Bounty {
        self.bounties.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such bounty"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

    const H: &str = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    fn as_(who: AccountId, deposit: u128) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(who)
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .build()
        );
    }
    fn n(milli: u128) -> u128 {
        milli * 10u128.pow(21)
    }

    /// client=0, liar=1 (cheapest), quitter=2, honest=3
    fn arena_with_bids() -> Arena {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "tasks/x".into(), H.into(), "noop: 0/8".into(), U128(n(200)), None);
        as_(accounts(1), n(300));
        c.bid(0, U128(n(500)));
        as_(accounts(2), n(200));
        c.bid(0, U128(n(600)));
        as_(accounts(3), n(200));
        c.bid(0, U128(n(800)));
        as_(accounts(0), 0);
        c.close_bidding(0);
        c
    }

    #[test]
    fn lie_then_abandon_then_ship() {
        let mut c = arena_with_bids();
        assert_eq!(c.get(0).worker.unwrap().agent, accounts(1));
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        as_(accounts(0), 0);
        let b = c.verdict(0, false, "hidden 3/8".into());
        assert_eq!(b.worker.as_ref().unwrap().agent, accounts(2));
        assert_eq!(b.pot[0].1.0, n(300));
        as_(accounts(2), 0);
        let b = c.abandon(0, "visible tests fail".into());
        assert_eq!(b.pot[1].1.0, n(40));
        assert_eq!(b.worker.as_ref().unwrap().agent, accounts(3));
        as_(accounts(3), 0);
        c.claim_done(0, H.into(), H.into());
        as_(accounts(0), 0);
        let b = c.verdict(0, true, "hidden 8/8".into());
        assert_eq!(b.status, Status::Paid);
        assert!(b.pot.is_empty());
        let board = c.leaderboard();
        assert_eq!(board[0].agent, accounts(3));
        assert_eq!(board[0].stats.earned.0, n(800 + 300 + 40));
        let liar = board.iter().find(|s| s.agent == accounts(1)).unwrap();
        assert_eq!((liar.stats.false_claims, liar.stats.slashed.0), (1, n(300)));
    }

    #[test]
    #[should_panic(expected = "only the client")]
    fn worker_cannot_judge_itself() {
        let mut c = arena_with_bids();
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        c.verdict(0, true, "trust me".into());
    }

    #[test]
    #[should_panic(expected = "can only abandon before claiming")]
    fn cannot_abandon_after_claiming() {
        let mut c = arena_with_bids();
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        c.abandon(0, "changed my mind".into());
    }

    #[test]
    #[should_panic(expected = "stake must be at least")]
    fn stake_below_minimum_refused() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        as_(accounts(1), n(100));
        c.bid(0, U128(n(500)));
    }

    #[test]
    #[should_panic(expected = "ask must be between")]
    fn ask_above_reward_refused() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        as_(accounts(1), n(200));
        c.bid(0, U128(n(1200)));
    }

    #[test]
    fn all_fail_reopens_and_cancel_refunds_pot() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        as_(accounts(1), n(200));
        c.bid(0, U128(n(500)));
        as_(accounts(0), 0);
        c.close_bidding(0);
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        as_(accounts(0), 0);
        let b = c.verdict(0, false, "hidden 0/8".into());
        assert_eq!(b.status, Status::Bidding);
        let b = c.cancel(0);
        assert_eq!(b.status, Status::Cancelled);
        assert!(b.pot.is_empty());
    }

    #[test]
    #[should_panic(expected = "claim window still open")]
    fn expire_waits_for_window() {
        let mut c = arena_with_bids();
        as_(accounts(4), 0);
        c.expire(0);
    }

    fn as_at(who: AccountId, ns: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who).block_timestamp(ns).build());
    }

    #[test]
    #[should_panic(expected = "verdict window still open")]
    fn verdict_timeout_waits_for_window() {
        let mut c = arena_with_bids();
        as_at(accounts(1), 1_000);
        c.claim_done(0, H.into(), H.into());
        as_at(accounts(4), 1_000 + 60 * 60 * 1_000_000_000);
        c.verdict_timeout(0);
    }

    #[test]
    fn silent_judge_pays_the_worker() {
        let mut c = arena_with_bids();
        as_at(accounts(1), 1_000);
        c.claim_done(0, H.into(), H.into());
        as_at(accounts(4), 1_001 + 60 * 60 * 1_000_000_000);
        let b = c.verdict_timeout(0);
        assert_eq!(b.status, Status::Paid);
        assert!(b.log.last().unwrap().contains("no verdict within the window"));
        assert_eq!(c.agents.get(&accounts(1)).unwrap().paid, 1);
        assert!(env::storage_read(&claimed_at_key(0)).is_none());
    }

    #[test]
    #[should_panic(expected = "no claim to settle")]
    fn verdict_clears_the_timeout() {
        let mut c = arena_with_bids();
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        as_(accounts(0), 0);
        c.verdict(0, true, "hidden 8/8".into());
        as_at(accounts(4), u64::MAX / 2);
        c.verdict_timeout(0);
    }

    /// client=0, verifier=5, worker=1
    fn arena_with_verifier() -> Arena {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), Some(accounts(5)));
        as_(accounts(1), n(200));
        c.bid(0, U128(n(500)));
        as_(accounts(0), 0);
        c.close_bidding(0);
        as_(accounts(1), 0);
        c.claim_done(0, H.into(), H.into());
        c
    }

    #[test]
    #[should_panic(expected = "only the verifier")]
    fn client_cannot_judge_when_verifier_named() {
        let mut c = arena_with_verifier();
        as_(accounts(0), 0);
        c.verdict(0, false, "hidden 0/8".into());
    }

    #[test]
    fn verifier_judges() {
        let mut c = arena_with_verifier();
        assert_eq!(c.get_verifier(0), Some(accounts(5)));
        as_(accounts(5), 0);
        let b = c.verdict(0, true, "hidden 8/8".into());
        assert_eq!(b.status, Status::Paid);
        assert!(b.log.iter().any(|l| l.contains("verdicts by")));
    }

    #[test]
    #[should_panic(expected = "the verifier cannot bid")]
    fn verifier_cannot_bid() {
        let mut c = arena_with_verifier();
        as_(accounts(5), n(200));
        c.bid(0, U128(n(500)));
    }

    #[test]
    #[should_panic(expected = "must not be the client")]
    fn client_cannot_be_verifier() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), Some(accounts(0)));
    }

    fn long(c: char) -> AccountId {
        format!("{}.testnet", c.to_string().repeat(56)).parse().unwrap()
    }

    #[test]
    fn storage_fee_covers_worst_case() {
        let client = long('c');
        as_(client.clone(), n(2000));
        let mut c = Arena::new(None);
        let (title, spec, check) = ("t".repeat(120), "s".repeat(1000), "g".repeat(200));
        let fee = c.storage_fee(client.clone(), title.clone(), spec.clone(), check.clone()).0;
        let before = env::storage_usage();
        c.post_bounty(title, spec, H.into(), check, U128(n(10)), Some(long('v')));
        let agents: Vec<AccountId> = (0..MAX_BIDS).map(|i| format!("{}{i:02}.testnet", "a".repeat(54)).parse().unwrap()).collect();
        for a in &agents {
            as_(a.clone(), n(10));
            c.bid(0, U128(n(500)));
        }
        as_(client.clone(), 0);
        c.close_bidding(0);
        for i in 0..agents.len() {
            as_(agents[i].clone(), 0);
            c.claim_done(0, "p".repeat(80), "t".repeat(80));
            if i + 1 < agents.len() {
                as_(long('v'), 0);
                c.verdict(0, false, "e".repeat(300));
            }
        }
        c.bounties.flush();
        c.agents.flush();
        let used = env::storage_usage() - before;
        let b = c.get(0);
        assert_eq!((b.pot.len(), b.log.len()), (MAX_BIDS as usize - 1, MAX_LOG));
        assert!(b.log.iter().all(|l| l.len() <= MAX_LINE));
        assert!(
            used as u128 * env::storage_byte_cost().as_yoctonear() <= fee,
            "used {used} bytes, fee covers {}",
            fee / env::storage_byte_cost().as_yoctonear()
        );
    }

    #[test]
    fn storage_fee_covers_withdrawals() {
        let client = long('c');
        as_(client.clone(), n(2000));
        let mut c = Arena::new(None);
        let (title, spec, check) = ("t".repeat(120), "s".repeat(1000), "g".repeat(200));
        let fee = c.storage_fee(client.clone(), title.clone(), spec.clone(), check.clone()).0;
        let before = env::storage_usage();
        c.post_bounty(title, spec, H.into(), check, U128(n(10)), Some(long('v')));
        for i in 0..MAX_BIDS {
            as_(format!("{}{i:02}.testnet", "a".repeat(54)).parse().unwrap(), n(10));
            c.bid(0, U128(n(500)));
            c.withdraw_bid(0);
        }
        c.bounties.flush();
        c.agents.flush();
        let used = env::storage_usage() - before;
        assert!(
            used as u128 * env::storage_byte_cost().as_yoctonear() <= fee,
            "used {used} bytes, fee covers {}",
            fee / env::storage_byte_cost().as_yoctonear()
        );
    }

    #[test]
    fn fee_is_kept_from_the_deposit() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        let fee = c.storage_fee(accounts(0), "fix it".into(), "x".into(), "".into()).0;
        let b = c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        assert_eq!(b.reward.0, n(1000) - fee);
    }

    #[test]
    #[should_panic(expected = "reward after the storage fee")]
    fn deposit_that_only_covers_storage_is_refused() {
        as_(accounts(0), n(50));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
    }

    #[test]
    #[should_panic(expected = "bounty is full")]
    fn withdrawn_bids_still_count() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        for i in 0..=MAX_BIDS {
            as_(format!("w{i}.testnet").parse().unwrap(), n(200));
            c.bid(0, U128(n(500)));
            c.withdraw_bid(0);
        }
    }

    #[test]
    #[should_panic(expected = "you withdrew from this bounty")]
    fn withdraw_is_final_for_that_bounty() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)), None);
        as_(accounts(1), n(200));
        c.bid(0, U128(n(500)));
        c.withdraw_bid(0);
        as_(accounts(1), n(200));
        c.bid(0, U128(n(500)));
    }

    fn callback(result: PromiseResult) {
        let ctx = VMContextBuilder::new().current_account_id(accounts(5)).predecessor_account_id(accounts(5)).build();
        testing_env!(ctx, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
    }

    #[test]
    fn failed_transfer_is_owed_and_can_be_withdrawn() {
        let mut c = arena_with_bids();
        callback(PromiseResult::Failed);
        assert!(!c.on_transfer(accounts(3), U128(n(200))));
        callback(PromiseResult::Failed);
        c.on_transfer(accounts(3), U128(n(100)));
        assert_eq!(c.get_owed(accounts(3)).0, n(300));
        callback(PromiseResult::Successful(vec![]));
        assert!(c.on_transfer(accounts(2), U128(n(100))));
        assert_eq!(c.get_owed(accounts(2)).0, 0);
        as_(accounts(3), 0);
        assert_eq!(c.withdraw_owed().0, n(300));
        assert_eq!(c.get_owed(accounts(3)).0, 0);
    }

    #[test]
    #[should_panic(expected = "nothing owed to you")]
    fn nothing_owed_refused() {
        let mut c = arena_with_bids();
        as_(accounts(3), 0);
        c.withdraw_owed();
    }
}
