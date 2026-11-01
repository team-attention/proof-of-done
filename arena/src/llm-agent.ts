// A real coding agent works the bounty: it gets a scratch copy of the task with only the visible
// tests, edits src/duration.ts, and must decide by itself whether to claim "done" or give up.
// Its patch is saved to solutions/parse-duration/<name>.ts and a short record to <name>.json,
// so the demo replays it without keys. Re-record with:
//
//   bun src/llm-agent.ts claude-haiku     (needs the `claude` CLI, logged in)
//   bun src/llm-agent.ts codex            (needs the `codex` CLI, logged in)
import { $ } from "bun";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, TASK, TASK_DIR, runTests, sha256, solutionPath } from "./grader";

export const PROMPT = `You are bidding on a paid bounty. Fix the bug described in README.md by editing src/duration.ts only.
Run \`bun test\` to check the visible tests. Hidden tests you cannot see will decide whether you get paid.
If you claim done and the hidden tests fail, you lose your whole stake. If you give up, you lose 20%.
When finished, reply with exactly one last line: CLAIM if you are confident the work is complete, or ABANDON if not.`;

const TOOLS = "Read,Edit,Write,Bash(bun test:*)";

const RUNNERS: Record<string, { model: string; run: (dir: string) => Promise<string> }> = {
  "claude-haiku": {
    model: "claude-haiku (Claude Code CLI, -p)",
    run: async (dir) =>
      (await $`claude -p ${PROMPT} --model haiku --setting-sources project --allowedTools ${TOOLS} --max-turns 20`.cwd(dir).nothrow().quiet()).stdout.toString(),
  },
  codex: {
    model: "codex (Codex CLI default model, exec)",
    run: async (dir) =>
      (await $`codex exec --sandbox workspace-write --skip-git-repo-check --ephemeral ${PROMPT} < /dev/null`.cwd(dir).nothrow().quiet()).stdout.toString(),
  },
};

export interface LlmRecord {
  agent: string;
  model: string;
  recorded: string;
  seconds: number;
  decision: "CLAIM" | "ABANDON" | "NONE";
  visible: string;
  patch: string;
  last_reply: string;
}

/** The agent's own last word decides claim vs abandon. Anything else counts as no claim. */
export const decisionOf = (reply: string): LlmRecord["decision"] => {
  const last = reply.trim().split("\n").pop()?.trim().toUpperCase() ?? "";
  return last.includes("ABANDON") ? "ABANDON" : last.includes("CLAIM") ? "CLAIM" : "NONE";
};

export const recordPath = (name: string) => join(ROOT, "solutions", TASK, `${name}.json`);
export const loadRecord = (name: string): LlmRecord => JSON.parse(readFileSync(recordPath(name), "utf8"));

if (import.meta.main) {
  const name = process.argv[2] ?? "";
  const runner = RUNNERS[name];
  if (!runner) throw new Error(`usage: bun src/llm-agent.ts <${Object.keys(RUNNERS).join("|")}>`);
  const dir = mkdtempSync(join(tmpdir(), "pod-agent-"));
  try {
    cpSync(TASK_DIR, dir, { recursive: true });
    const t0 = Date.now();
    const reply = await runner.run(dir);
    const seconds = Math.round((Date.now() - t0) / 1000);
    const out = solutionPath(name);
    cpSync(join(dir, "src", "duration.ts"), out);
    const visible = await runTests(out, "visible");
    const rec: LlmRecord = {
      agent: name,
      model: runner.model,
      recorded: new Date().toISOString(),
      seconds,
      decision: decisionOf(reply),
      visible: `${visible.pass}/${visible.total}`,
      patch: sha256(readFileSync(out)),
      // keep the reply short and free of local paths
      last_reply: reply.trim().split(dir).join(".").split(tmpdir()).join("$TMP").slice(-600),
    };
    writeFileSync(recordPath(name), JSON.stringify(rec, null, 2) + "\n");
    console.log(JSON.stringify(rec, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
