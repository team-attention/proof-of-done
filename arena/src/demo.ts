// One bounty, four agents, one rule for all of them: run the visible tests on your own patch,
// claim "done" if they pass, abandon if they don't. The hidden tests decide who was right.
//
//   bun src/demo.ts             local NEAR node (near-sandbox), about a minute
//   bun src/demo.ts --testnet   same story on NEAR testnet; needs FUNDER_ID / FUNDER_KEY in .env.
//                               Later runs reuse the arena and agents in .state/testnet.json, so the
//                               on-chain leaderboard accumulates across rounds.
import { Account, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto, teraToGas, yoctoToNear } from "near-api-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TASK, graderCheck, hiddenTestsHash, runTests, sha256, solutionPath } from "./grader";

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
/** Same rule for everyone; they differ only in what they ship and what they ask. */
export const AGENTS = [
  { name: "cheapskate", ask: "0.5", stake: "0.3", ships: "visible-hardcode", note: "makes the failing visible test pass, fixes nothing" },
  { name: "quitter", ask: "0.6", stake: "0.2", ships: "noop", note: "could not fix it" },
  { name: "steady", ask: "0.8", stake: "0.2", ships: "honest", note: "fixes the parser" },
  { name: "greedy", ask: "1.2", stake: "0.2", ships: "honest", note: "asks more than the reward" },
] as const;

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

  step(`accounts on ${testnet ? "testnet" : "a local node"}`);
  if (testnet && existsSync(STATE)) {
    const saved = JSON.parse(readFileSync(STATE, "utf8"));
    Object.assign(ids, saved.ids);
    Object.assign(keys, saved.keys);
    for (const k of Object.keys(ids)) accounts[k] = new Account(ids[k]!, rpc, keys[k] as KeyPairString);
    console.log(`  reusing arena ${arenaId()} and its agents`);
    await topUp("client", "1.25");
    for (const a of AGENTS) await topUp(a.name, (Number(a.stake) + 0.15).toFixed(2));
  } else {
    await create("arena", testnet ? "2.3" : "5");
    await create("client", "1.25");
    for (const a of AGENTS) await create(a.name, testnet ? (Number(a.stake) + 0.15).toFixed(2) : "1");
    await accounts.arena!.deployContract(readFileSync(join(ROOT, "contracts", "out", "arena.wasm")));
    await call("arena", "new", { claim_window_minutes: 60 });
    console.log(`  arena contract -> ${arenaId()}`);
  }

  step(`client posts a ${REWARD} NEAR bounty: fix parseDuration`);
  const posted = await call("client", "post_bounty", { title: "Fix parseDuration", spec: `tasks/${TASK}`, tests_hash: testsHash, grader_check: g.summary, min_stake: near(MIN_STAKE).toString() }, near(REWARD));
  const bountyId = posted.id;
  console.log(`  bounty #${bountyId}, min stake ${MIN_STAKE} NEAR, asks capped at the reward`);

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
    if (visible.pass < visible.total) {
      b = await call(agent.name, "abandon", { id: bountyId, reason: `visible tests ${visible.pass}/${visible.total}` });
      console.log(color.yellow(`  abandons before claiming -> keeps 80% of its stake`));
      continue;
    }
    const patch = sha256(readFileSync(file));
    const trace = sha256(visible.output);
    await call(agent.name, "claim_done", { id: bountyId, patch, trace });
    console.log(`  claims done: patch ${patch.slice(0, 19)}…`);

    const hidden = await runTests(file, "hidden");
    const passed = hidden.pass === hidden.total;
    console.log(`  client runs hidden tests: ${(passed ? color.green : color.red)(`${hidden.pass}/${hidden.total}`)}`);
    b = await call("client", "verdict", { id: bountyId, passed, evidence: `hidden ${hidden.pass}/${hidden.total}, tests ${testsHash.slice(0, 15)}…` });
    console.log(passed ? color.green(`  paid`) : color.red(`  false claim -> whole stake slashed into the pot`));
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
