// Runs a solution file against the visible or hidden tests in a scratch copy of the task.
// Also the pre-flight check: a grader that a no-op or a visible-test hardcode can pass is broken.
import { $ } from "bun";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
/** Each task: the one file an agent may edit, and the bounty title on chain. Pick with `--task <name>`. */
export const TASKS: Record<string, { file: string; title: string }> = {
  "parse-duration": { file: "src/duration.ts", title: "Fix parseDuration" },
  "split-amount": { file: "src/split.ts", title: "Fix splitAmount" },
};
const flag = process.argv.indexOf("--task");
export const TASK = flag > 0 ? process.argv[flag + 1]! : "parse-duration";
if (!TASKS[TASK]) throw new Error(`unknown task ${TASK}; one of ${Object.keys(TASKS).join(", ")}`);
export const { file: TASK_FILE, title: TASK_TITLE } = TASKS[TASK]!;
export const TASK_DIR = join(ROOT, "tasks", TASK);
export const HIDDEN_DIR = join(ROOT, "client", "hidden-tests", TASK);
export const solutionPath = (name: string) => join(ROOT, "solutions", TASK, `${name}.ts`);

export interface TestRun {
  pass: number;
  total: number;
  output: string;
}

export const sha256 = (data: string | Buffer) => `sha256:${createHash("sha256").update(data).digest("hex")}`;

/** sha256 over the hidden test files, in name order. This goes on chain before any bid. */
export function hiddenTestsHash() {
  const files = readdirSync(HIDDEN_DIR).sort();
  return sha256(files.map((f) => `${f}\n${readFileSync(join(HIDDEN_DIR, f), "utf8")}`).join("\n"));
}

export async function runTests(solution: string, which: "visible" | "hidden"): Promise<TestRun> {
  const work = mkdtempSync(join(tmpdir(), "proof-of-done-"));
  try {
    cpSync(TASK_DIR, work, { recursive: true });
    cpSync(solution, join(work, TASK_FILE));
    if (which === "hidden") {
      rmSync(join(work, "test"), { recursive: true });
      cpSync(HIDDEN_DIR, join(work, "test"), { recursive: true });
    }
    const res = await $`bun test`.cwd(work).nothrow().quiet();
    const output = res.stderr.toString().replace(/\x1b\[[0-9;]*m/g, "");
    const num = (k: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${k}`, "m"))?.[1] ?? 0);
    const pass = num("pass");
    return { pass, total: pass + num("fail"), output };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Refuse to post a bounty whose hidden tests a do-nothing or a hardcoded patch can pass. */
export async function graderCheck() {
  const noop = await runTests(join(TASK_DIR, TASK_FILE), "hidden");
  const hack = await runTests(solutionPath("visible-hardcode"), "hidden");
  const ok = noop.pass < noop.total && hack.pass < hack.total;
  return { ok, noop, hack, summary: `noop ${noop.pass}/${noop.total}, visible-hardcode ${hack.pass}/${hack.total} on hidden tests` };
}

if (import.meta.main) {
  const g = await graderCheck();
  console.log(`task ${TASK}, hidden tests ${hiddenTestsHash()}`);
  console.log(`${g.summary} -> ${g.ok ? "grader OK" : "grader BROKEN: do not post"}`);
  const names = readdirSync(join(ROOT, "solutions", TASK)).filter((f) => f.endsWith(".ts")).map((f) => f.slice(0, -3));
  for (const s of names) {
    const v = await runTests(solutionPath(s), "visible");
    const h = await runTests(solutionPath(s), "hidden");
    console.log(`  ${s.padEnd(17)} visible ${v.pass}/${v.total}  hidden ${h.pass}/${h.total}`);
  }
  process.exit(g.ok ? 0 : 1);
}
