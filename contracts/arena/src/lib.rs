//! Proof of Done arena: agents stake NEAR to bid on a coding bounty, the lowest ask gets the job,
//! and saying "done" is a bet. If the client's hidden tests fail, the whole stake is slashed.
//! Giving up honestly before claiming costs 20%. Slashed stake never goes to the client: it is
//! added to the bounty and paid to the agent whose work actually passes (or returned on cancel),
//! so a client gains nothing by failing good work.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::IterableMap;
use near_sdk::{AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, env, near, require};

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
const MAX_BIDS: usize = 20;
const MAX_LOG: usize = 40;

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "proof-of-done", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

fn pay(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(yocto)).detach();
    }
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
    #[payable]
    pub fn post_bounty(&mut self, title: String, spec: String, tests_hash: String, grader_check: String, min_stake: U128) -> Bounty {
        let reward = env::attached_deposit().as_yoctonear();
        require!(reward >= NearToken::from_millinear(10).as_yoctonear(), "reward must be at least 0.01 NEAR");
        require!(min_stake.0 > 0, "min_stake must be positive");
        require!(title.len() <= 120 && spec.len() <= 1000 && grader_check.len() <= 200, "text too long");
        require!(tests_hash.starts_with("sha256:") && tests_hash.len() == 71, "tests_hash must be sha256:<64 hex>");
        let client = env::predecessor_account_id();
        let b = Bounty {
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
            log: vec![format!("{client} posted {} (min stake {})", near_str(reward), near_str(min_stake.0))],
        };
        self.next_id += 1;
        self.bounties.insert(b.id, b.clone());
        emit("bounty_posted", json!({"id": b.id, "client": client, "reward": b.reward}));
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
        require!(stake >= b.min_stake.0, format!("stake must be at least {}", near_str(b.min_stake.0)));
        require!(ask.0 > 0 && ask.0 <= b.reward.0, format!("ask must be between 0 and the reward ({})", near_str(b.reward.0)));
        require!(
            !b.bids.iter().any(|x| x.agent == agent) && b.worker.as_ref().is_none_or(|w| w.agent != agent),
            "one bid per agent"
        );
        require!(b.bids.len() < MAX_BIDS, "too many bids");
        b.bids.push(Bid { agent: agent.clone(), ask, stake: U128(stake) });
        Self::note(&mut b, format!("{agent} bid {} with {} stake", near_str(ask.0), near_str(stake)));
        self.stats(&agent, |s| s.bids += 1);
        self.bounties.insert(id, b.clone());
        emit("bid", json!({"id": id, "agent": agent, "ask": ask, "stake": U128(stake)}));
        b
    }

    /// A bidder who is not the current worker can leave and get the full stake back.
    pub fn withdraw_bid(&mut self, id: u64) -> Bounty {
        let agent = env::predecessor_account_id();
        let mut b = self.get(id);
        let i = b.bids.iter().position(|x| x.agent == agent).unwrap_or_else(|| env::panic_str("no open bid from you"));
        let bid = b.bids.remove(i);
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

    /// Client reports the hidden-test result. `evidence` should say how to re-run it.
    pub fn verdict(&mut self, id: u64, passed: bool, evidence: String) -> Bounty {
        let mut b = self.get(id);
        require!(env::predecessor_account_id() == b.client, "only the client can give a verdict");
        require!(b.status == Status::Claimed, "no claim to judge");
        require!(evidence.len() <= 300, "evidence too long");
        let w = b.worker.take().unwrap();
        if passed {
            let pot: u128 = b.pot.iter().map(|(_, a)| a.0).sum();
            let earned = w.ask.0 + pot;
            pay(&w.agent, earned + w.stake.0);
            pay(&b.client, b.reward.0 - w.ask.0);
            for other in b.bids.drain(..) {
                pay(&other.agent, other.stake.0);
            }
            self.stats(&w.agent, |s| {
                s.paid += 1;
                s.earned = U128(s.earned.0 + earned);
            });
            b.status = Status::Paid;
            Self::note(&mut b, format!("PASSED: {} paid {} (ask {} + pot {}); {evidence}", w.agent, near_str(earned), near_str(w.ask.0), near_str(pot)));
            emit("paid", json!({"id": id, "agent": w.agent, "earned": U128(earned), "evidence": evidence}));
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

    /// Client cancels while nobody holds the job: reward back to the client, every stake and
    /// every slashed amount back to its agent.
    pub fn cancel(&mut self, id: u64) -> Bounty {
        let mut b = self.get(id);
        require!(env::predecessor_account_id() == b.client, "only the client can cancel");
        require!(b.status == Status::Bidding, "can only cancel while bidding");
        pay(&b.client, b.reward.0);
        for bid in b.bids.drain(..) {
            pay(&bid.agent, bid.stake.0);
        }
        for (agent, amount) in b.pot.drain(..) {
            pay(&agent, amount.0);
        }
        b.status = Status::Cancelled;
        Self::note(&mut b, "cancelled by the client; all stakes returned".into());
        self.bounties.insert(id, b.clone());
        b
    }

    // --- views

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
        json!({"claim_window_minutes": self.claim_window_ns / 60_000_000_000, "abandon_fee_pct": ABANDON_FEE_PCT as u64})
    }

    // --- internal

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

    fn note(b: &mut Bounty, line: String) {
        if b.log.len() >= MAX_LOG {
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
    use near_sdk::testing_env;

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
        c.post_bounty("fix it".into(), "tasks/x".into(), H.into(), "noop: 0/8".into(), U128(n(200)));
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
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)));
        as_(accounts(1), n(100));
        c.bid(0, U128(n(500)));
    }

    #[test]
    #[should_panic(expected = "ask must be between")]
    fn ask_above_reward_refused() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)));
        as_(accounts(1), n(200));
        c.bid(0, U128(n(1200)));
    }

    #[test]
    fn all_fail_reopens_and_cancel_refunds_pot() {
        as_(accounts(0), n(1000));
        let mut c = Arena::new(None);
        c.post_bounty("fix it".into(), "x".into(), H.into(), "".into(), U128(n(200)));
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
}
