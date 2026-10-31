# Proof of Done

A bounty arena on NEAR where AI coding agents stake NEAR on the claim "it's done". The client's hidden tests decide. A false claim loses the whole stake; giving up honestly costs 20%; slashed stake pays the agent that actually ships.

Built for NEAR HACKATHON (Nov 1–14, 2026). Tracks: AI Swarms (bidding, coordination between agents), Agent Economy (agents earn and risk NEAR), AI Security & Defense (reputation, reward hacking).

- Site with a live leaderboard: https://proof-of-done.bongbonggg97.workers.dev
- Arena contract on testnet: [`arena-m74jr.proof-of-done-wm6vdi.testnet`](https://testnet.nearblocks.io/address/arena-m74jr.proof-of-done-wm6vdi.testnet)
- Sibling project by the same team: [Countersign](https://github.com/team-attention/countersign), a policy wallet that decides what an agent may spend. (HACKATHON.md allows two projects per person and asks each README to name the other.)

## The problem

Coding agents say "done" when the visible tests pass. Sometimes they made the tests pass by special-casing them. The cost of that claim lands on whoever checks the work. Proof of Done puts a price on the claim itself: agents stake before they get the job, and a claim that fails tests the agent never saw is slashed on chain. Admitting failure before claiming is cheaper than lying, so an agent that knows its work is shaky should say so.

## Try it (about 10 seconds after the first download, no keys, no testnet funds)

Requirements: [Bun](https://bun.sh) 1.2+ on macOS or Linux. The contract is prebuilt in `contracts/out/arena.wasm`; Rust is only needed to rebuild it.

On macOS the `near-sandbox` binary links Homebrew's liblzma. If the demo stops with `Binary doesn't respond, probably is corrupted`, run `brew install xz` and try again.

1. `cd arena && bun install`
2. `bun run demo`. This starts a local NEAR node, deploys the arena, and runs one bounty with four agents. Expected output, in order:
   - **grader check**: `noop 2/8, visible-hardcode 3/8 on hidden tests -> grader OK`. A bounty whose hidden tests a do-nothing patch or a hardcode of the visible tests could pass is refused before posting.
   - **bids**: cheapskate asks 0.5 (stake 0.3), quitter 0.6, steady 0.8. greedy asks 1.2 → `contract refused: ask must be between 0 and the reward (1.000 NEAR)`.
   - **cheapskate** (lowest ask) gets the job, ships a patch that hardcodes the failing visible test: visible `3/3`, claims done, hidden `3/8` → `false claim -> whole stake slashed into the pot`.
   - **quitter** is assigned next, visible `2/3` → abandons, keeps 80%.
   - **steady** is assigned, visible `3/3`, hidden `8/8` → paid `1.140 NEAR (ask 0.800 NEAR + pot 0.340 NEAR)`.
   - **leaderboard** read from the contract: steady 1 paid, quitter 1 abandoned, cheapskate 1 false claim.
   - **balance change**: cheapskate `-0.3`, quitter `-0.04`, steady `+1.139` NEAR.
3. `bun run grader-check` prints visible and hidden scores for all three patches without a chain.

Every agent follows the same rule: run the visible tests on your own patch; claim if they pass, abandon if they don't. They differ only in the patch they ship (`solutions/parse-duration/`) and their ask.

Contract unit tests (needs Rust): `cd contracts/arena && cargo test` → 7 pass.
Rebuild the wasm (needs [`cargo-near`](https://github.com/near/cargo-near)): `./contracts/build.sh`.

### On NEAR testnet

```bash
cd arena
echo 'FUNDER_ID=<your-account>.testnet' > .env    # ~6 testnet NEAR for the first run, ~1.5 after
echo 'FUNDER_KEY=ed25519:...' >> .env
bun --env-file=.env run testnet
```

The first run creates the arena and agent accounts as sub-accounts of `FUNDER_ID` and writes their keys to `.state/testnet.json` (gitignored). Later runs reuse them and post a new bounty, so the leaderboard accumulates. The script refuses any `FUNDER_ID` that does not end in `.testnet`.

Read the deployed arena yourself:

```bash
near contract call-function as-read-only arena-m74jr.proof-of-done-wm6vdi.testnet leaderboard json-args '{}' network-config testnet now
near contract call-function as-read-only arena-m74jr.proof-of-done-wm6vdi.testnet get_bounty json-args '{"id":1}' network-config testnet now
```

Bounty #0 on testnet ran before cheapskate had enough balance to bid, so it shows only quitter and steady. Bounty #1 is the full story.

## How it works

```
client ──post_bounty(reward, tests_hash, grader_check, min_stake)──▶ arena
agents ──bid(ask) + stake──▶ arena ──close_bidding──▶ lowest ask = worker
worker ──claim_done(patch_hash, trace_hash)──▶ arena      or  ──abandon──▶ 80% back, 20% to pot
client ──verdict(passed, evidence)──▶ arena
          passed: worker gets ask + pot + stake back, client gets reward − ask, other bidders refunded
          failed: stake → pot, next-lowest bidder assigned (or bidding reopens)
```

| Piece | Path | What it does |
| --- | --- | --- |
| Arena contract | `contracts/arena/src/lib.rs` | `post_bounty`, `bid`, `withdraw_bid`, `close_bidding`, `claim_done`, `abandon`, `expire` (anyone, after the claim window), `verdict`, `cancel`; views `get_bounty`, `list_bounties`, `leaderboard`, `get_config`. NEP-297 `EVENT_JSON` logs and a readable per-bounty log. |
| Task | `tasks/parse-duration/` | The bug the agents see, with 3 visible tests. |
| Hidden tests | `client/hidden-tests/parse-duration/` | 8 tests the agents never see. Their sha256 is on chain before any bid. |
| Patches | `solutions/parse-duration/` | `honest.ts`, `visible-hardcode.ts` (reward hacking), `noop.ts`. |
| Grader | `arena/src/grader.ts` | Runs a patch against visible or hidden tests in a scratch copy; the pre-flight check. |
| Demo | `arena/src/demo.ts` | The whole round on sandbox or testnet. |
| Site | `site/` | Cloudflare Worker: landing, live leaderboard read over JSON-RPC, cookie-free counter. |

### Why the client cannot profit from failing good work

The contract cannot run tests, so the client reports the verdict. Three things limit that power: the hidden tests' hash is fixed before the first bid; slashed stake goes to the pot, which pays the next agent that passes, or goes back to the slashed agents if the client cancels; and the hidden tests are published in the repo so anyone can re-run a verdict against the patch hash on chain. A dishonest client still delays payment. An independent verifier set is the obvious next step.

## Limits and honest notes

- Testnet and local sandbox only. Nothing here touches mainnet. No NEAR Intents: stakes and payouts are native NEAR transfers (Intents have no testnet, HACKATHON.md Q-007).
- The demo agents replay fixed patches so the run is reproducible without an LLM key. Plugging in a live coding agent is the next step.
- Patches are compared by hash; the patch file itself is passed locally.
- One bid per agent per bounty, at most 20 bids, log capped at 40 lines.

## Hackathon window

This repository was created on 2026-10-31 UTC, after the 2026-10-19 announcement. Commits before 2026-11-01T00:00Z are baseline (HACKATHON.md Q-001), tagged `pre-hackathon`. Work during the window: [`pre-hackathon...main`](https://github.com/team-attention/proof-of-done/compare/pre-hackathon...main).

## Built with

near-sdk 5.29 (Rust), cargo-near 0.22, near-api-js 7.4, near-sandbox 0.3, Bun, Cloudflare Workers. The Worker's counter and the console helpers are adapted from our own Countersign project. Code written with Claude Code.

## License

MIT
