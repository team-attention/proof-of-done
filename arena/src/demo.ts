// One bounty, six agents. Four scripted agents follow one rule: run the visible tests on your own
// patch, claim "done" if they pass, abandon if they don't. Two are real coding agents (Claude Haiku
// via the Claude Code CLI, Codex via the Codex CLI) that wrote their own patch and made their own
// claim-or-abandon call; the demo replays what they recorded (see llm-agent.ts). The hidden tests
// decide who was right.
//
//   bun src/demo.ts             local NEAR node (near-sandbox), about a minute
//   --task split-amount         the second bounty (default parse-duration); see grader.ts TASKS
//   --task format-near          the trap bounty: its README contradicts itself, so every claim fails
//                               and the client cancels at the end (reward and stakes go back)
//   bun src/demo.ts --testnet   same story on NEAR testnet; needs FUNDER_ID / FUNDER_KEY in .env.
//                               Later runs reuse the arena and agents in .state/testnet.json, so the
//                               on-chain leaderboard accumulates across rounds.
// Every bounty names a verifier account: the client posts, but only the verifier can give the
// verdict, so the client cannot fail good work to steer the pot to a second account it controls.
// A reused testnet arena that predates this is upgraded in place first (bounties 0-4 had no
// verifier, so the client judged those).
import { Account, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto, teraToGas, yoctoToNear } from "near-api-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRecord } from "./llm-agent";
import { IMPOSSIBLE, ROOT, TASK, TASK_TITLE, graderCheck, hiddenTestsHash, runTests, sha256, solutionPath } from "./grader";

const GAS = teraToGas("100");
const near = (n: string) => BigInt(nearToYocto(n as `${number}`).toString());
const fmt = (y: string | bigint) => `${yoctoToNear(BigInt(y), 3)} NEAR`;
const tty = process.stdout.isTTY || process.env.FORCE_COLOR;
const c = (n: number) => (s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const color = { green: c(32), red: c(31), yellow: c(33), dim: c(2), bold: c(1) };
const step = (t: string) => console.log(`\n${color.bold(`== ${t}`)}`);
const why = (e: unknown) => {
  const m = String(e instanceof Error ? e.message : e).match(/Smart contract panicked: ([^"\n]+)/);
  return m ? `contract refused: ${m[1]}` : String(e).split("\n")[0]!.slice(0, 200);
};

export const REWARD = "1";
export const MIN_STAKE = "0.2";
/** Scripted agents differ only in what they ship and what they ask. `llm` agents decide for themselves.
 *  An agent sits out a task that has no `solutions/<task>/<ships>.ts`. */
export const AGENTS: { name: string; ask: string; stake: string; ships: string; note: string; llm?: boolean }[] = [
  { name: "cheapskate", ask: "0.5", stake: "0.3", ships: "visible-hardcode", note: "makes the failing visible test pass, fixes nothing" },
  { name: "hasty", ask: "0.55", stake: "0.2", ships: "float-math", note: "a fix that looks right but does the math in Number" },
  { name: "literal", ask: "0.58", stake: "0.2", ships: "two-decimals", note: "does what the visible tests ask, skips the rest of the README" },
  { name: "quitter", ask: "0.6", stake: "0.2", ships: "noop", note: "could not fix it" },
  { name: "haiku", ask: "0.7", stake: "0.2", ships: "claude-haiku", note: "Claude Haiku wrote this patch and chose whether to claim", llm: true },
  { name: "codex", ask: "0.75", stake: "0.2", ships: "codex", note: "Codex wrote this patch and chose whether to claim", llm: true },
  { name: "steady", ask: "0.8", stake: "0.2", ships: "honest", note: "ships the reference fix" },
  { name: "greedy", ask: "1.2", stake: "0.2", ships: "honest", note: "asks more than the reward" },
].filter((a) => existsSync(solutionPath(a.ships)));

interface Bounty {
  id: number;
  status: string;
  worker?: { agent: string; ask: string; stake: string } | null;
  pot: [string, string][];
  log: string[];
}

const testnet = process.argv.includes("--testnet");
const t0 = Date.now();
let rpcUrl: string;
let funderId: string;
let funderKey: KeyPairString;
let stop = async () => {};

if (testnet) {
  funderId = process.env.FUNDER_ID ?? "";
  funderKey = process.env.FUNDER_KEY as KeyPairString;
  if (!funderId.endsWith(".testnet") || !funderKey) throw new Error("set FUNDER_ID (a .testnet account) and FUNDER_KEY in .env");
  rpcUrl = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
} else {
  const { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } = await import("near-sandbox");
  const sb = await Sandbox.start({});
  rpcUrl = sb.rpcUrl;
  funderId = DEFAULT_ACCOUNT_ID;
  funderKey = DEFAULT_PRIVATE_KEY as KeyPairString;
  stop = () => sb.tearDown();
}

const rpc = new JsonRpcProvider({ url: rpcUrl });
const funder = new Account(funderId, rpc, funderKey);
const tag = testnet ? `-${Date.now().toString(36).slice(-5)}` : "";
const id = (n: string) => `${n}${tag}.${funderId}`;
const accounts: Record<string, Account> = {};
const ids: Record<string, string> = {};
const keys: Record<string, string> = {};
const STATE = join(ROOT, ".state", "testnet.json");

async function create(name: string, amount: string) {
  const kp = KeyPair.fromRandom("ed25519");
  await funder.createAccount({ newAccountId: id(name), publicKey: kp.getPublicKey().toString(), nearToTransfer: near(amount) });
  accounts[name] = new Account(id(name), rpc, kp.toString() as KeyPairString);
  keys[name] = kp.toString();
  ids[name] = id(name);
  console.log(`  ${id(name).padEnd(44)} ${amount} NEAR`);
}
const arenaId = () => ids.arena!;
const nameOf = (account: string) => Object.keys(ids).find((k) => ids[k] === account) ?? account;
/** Top an existing testnet account up to `min` NEAR from the funder. */
async function topUp(name: string, min: string) {
  const have = await balance(name);
  if (have >= near(min)) return;
  await funder.transfer({ receiverId: ids[name]!, amount: near(min) - have });
  console.log(`  ${ids[name]!.padEnd(44)} topped up to ${min} NEAR`);
}
const call = (who: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
  accounts[who]!.callFunction({ contractId: arenaId(), methodName, args, deposit, gas: GAS }) as Promise<Bounty>;
const view = <T>(method: string, args: Record<string, unknown> = {}) => rpc.callFunction({ contractId: arenaId(), method, args }) as Promise<T>;
const balance = async (name: string) => BigInt((await accounts[name]!.getState()).balance.total);

try {
  step("grader check: can a do-nothing or a hardcoded patch pass the hidden tests?");
  const g = await graderCheck();
  console.log(`  ${g.summary} -> ${g.ok ? color.green("grader OK") : color.red("grader BROKEN")}`);
  if (!g.ok) throw new Error("refusing to post a bounty with a broken grader");
  const testsHash = hiddenTestsHash();
  console.log(`  hidden tests ${testsHash}`);
  if (IMPOSSIBLE) console.log(color.yellow(`  trap task: the README contradicts itself; no patch can pass every hidden test`));

  step(`accounts on ${testnet ? "testnet" : "a local node"}`);
  let judge = "client";
  if (testnet && existsSync(STATE)) {
    const saved = JSON.parse(readFileSync(STATE, "utf8"));
    Object.assign(ids, saved.ids);
    Object.assign(keys, saved.keys);
    for (const k of Object.keys(ids)) accounts[k] = new Account(ids[k]!, rpc, keys[k] as KeyPairString);
    console.log(`  reusing arena ${arenaId()} and its agents`);
    try {
      await view("get_verifier", { id: 0 });
    } catch {
      // Deployed before the verifier existed. The new code keeps the stored layout, so a plain
      // redeploy (no migration) keeps every bounty and the leaderboard.
      await accounts.arena!.deployContract(readFileSync(join(ROOT, "contracts", "out", "arena.wasm")));
      console.log(`  arena upgraded in place to the verifier-aware contract`);
    }
    if (!ids.verifier) await create("verifier", "0.3");
    judge = "verifier";
    await topUp("client", "1.25");
    for (const a of AGENTS) {
      const min = (Number(a.stake) + 0.15).toFixed(2);
      if (ids[a.name]) await topUp(a.name, min);
      else await create(a.name, min);
    }
  } else {
    await create("arena", testnet ? "2.3" : "5");
    await create("client", "1.25");
    await create("verifier", testnet ? "0.3" : "1");
    judge = "verifier";
    for (const a of AGENTS) await create(a.name, testnet ? (Number(a.stake) + 0.15).toFixed(2) : "1");
    await accounts.arena!.deployContract(readFileSync(join(ROOT, "contracts", "out", "arena.wasm")));
    await call("arena", "new", { claim_window_minutes: 60 });
    console.log(`  arena contract -> ${arenaId()}`);
  }

  step(`client posts a ${REWARD} NEAR bounty: ${TASK_TITLE}`);
  const posted = await call("client", "post_bounty", { title: TASK_TITLE, spec: `tasks/${TASK}`, tests_hash: testsHash, grader_check: g.summary, min_stake: near(MIN_STAKE).toString(), ...(judge === "verifier" && { verifier: ids.verifier }) }, near(REWARD));
  const bountyId = posted.id;
  console.log(`  bounty #${bountyId}, min stake ${MIN_STAKE} NEAR, asks capped at the reward`);
  if (judge === "verifier") console.log(`  verdicts by ${ids.verifier}, not the client`);

  step("agents bid (stake attached)");
  const start: Record<string, bigint> = {};
  for (const a of AGENTS) {
    start[a.name] = await balance(a.name);
    try {
      await call(a.name, "bid", { id: bountyId, ask: near(a.ask).toString() }, near(a.stake));
      console.log(`  ${a.name.padEnd(11)} ask ${a.ask}  stake ${a.stake}`);
    } catch (e) {
      console.log(`  ${a.name.padEnd(11)} ask ${a.ask}  ${color.red(why(e))}`);
    }
  }

  step("client closes bidding: lowest ask gets the job");
  let b = await call("client", "close_bidding", { id: bountyId });

  while (b.status === "Assigned") {
    const agent = AGENTS.find((a) => ids[a.name] === b.worker!.agent)!;
    step(`${agent.name} works (${agent.note})`);
    const file = solutionPath(agent.ships);
    const visible = await runTests(file, "visible");
    console.log(`  visible tests on its own patch: ${visible.pass}/${visible.total}`);
    const rec = agent.llm ? loadRecord(agent.ships) : null;
    if (rec) console.log(`  ${rec.model}, ${rec.seconds}s, recorded ${rec.recorded.slice(0, 10)}; its own call: ${rec.decision}`);
    const claims = rec ? rec.decision === "CLAIM" : visible.pass === visible.total;
    if (!claims) {
      b = await call(agent.name, "abandon", { id: bountyId, reason: rec ? `agent said ${rec.decision}` : `visible tests ${visible.pass}/${visible.total}` });
      console.log(color.yellow(`  abandons before claiming -> keeps 80% of its stake`));
      continue;
    }
    const patch = sha256(readFileSync(file));
    const trace = sha256(visible.output);
    await call(agent.name, "claim_done", { id: bountyId, patch, trace });
    console.log(`  claims done: patch ${patch.slice(0, 19)}…`);

    const hidden = await runTests(file, "hidden");
    const passed = hidden.pass === hidden.total;
    console.log(`  ${judge} runs hidden tests: ${(passed ? color.green : color.red)(`${hidden.pass}/${hidden.total}`)}`);
    b = await call(judge, "verdict", { id: bountyId, passed, evidence: `hidden ${hidden.pass}/${hidden.total}, tests ${testsHash.slice(0, 15)}…` });
    console.log(passed ? color.green(`  paid`) : color.red(`  false claim -> whole stake slashed into the pot`));
  }

  if (b.status === "Bidding") {
    step("every bidder failed or gave up: client cancels");
    b = await call("client", "cancel", { id: bountyId });
    console.log(`  reward back to the client; stakes and slashed amounts back to the agents. The false claims stay on the leaderboard.`);
  }

  step("bounty log (on chain)");
  for (const line of b.log) console.log(color.dim(`  ${line}`));

  step("leaderboard (on chain)");
  const board = await view<{ agent: string; stats: any }[]>("leaderboard");
  console.log(color.dim(`  ${"agent".padEnd(11)} paid  false-claims  abandoned  earned      slashed`));
  for (const { agent, stats: s } of board) {
    const name = nameOf(agent);
    console.log(`  ${name.padEnd(11)} ${String(s.paid).padEnd(5)} ${String(s.false_claims).padEnd(13)} ${String(s.abandoned).padEnd(10)} ${fmt(s.earned).padEnd(11)} ${fmt(s.slashed)}`);
  }

  step("balance change per agent (includes gas)");
  for (const a of AGENTS) {
    const d = (await balance(a.name)) - start[a.name]!;
    console.log(`  ${a.name.padEnd(11)} ${(d >= 0n ? color.green : color.red)(`${d >= 0n ? "+" : "-"}${fmt(d >= 0n ? d : -d)}`)}`);
  }

  if (testnet) {
    mkdirSync(join(ROOT, ".state"), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ rpcUrl, ids, keys }, null, 2), { mode: 0o600 });
    console.log(`\n  arena on testnet: https://testnet.nearblocks.io/address/${arenaId()}`);
  }
  console.log(color.green(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s`));
} finally {
  await stop();
}
