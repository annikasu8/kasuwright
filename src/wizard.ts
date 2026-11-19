/**
 * Zero-knowledge wizard (v0.4) — the product goal: the user should not need
 * to know flags, env vars or file formats. Running `kasuwright` with no
 * arguments is the whole interface:
 *
 *   Step 1 — pick the BRD (auto-detected in the current folder when possible)
 *   Step 2 — press Enter (project key defaults to QA)
 *
 * Everything else — Jira export, cases, data, framework, specs, traceability,
 * report, email draft, CI files — runs automatically, and the HTML report
 * opens in the browser when the run finishes.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { runPipeline, type PipelineSummary } from "./pipeline.js";
import { llmFromEnv } from "./llm.js";

const BRD_NAME = /(brd|requirement|srs|prd|spec)/i;
const DOC_EXT = /\.(md|markdown|txt)$/i;

/** Candidate BRD files in a folder: BRD-named docs first, then any doc. */
export function findBrdCandidates(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => DOC_EXT.test(n) && !/^readme/i.test(n));
  } catch {
    return [];
  }
  const scored = names
    .map((n) => ({ n, score: BRD_NAME.test(n) ? 0 : 1 }))
    .sort((a, b) => a.score - b.score || a.n.localeCompare(b.n));
  return scored.map((s) => join(dir, s.n));
}

/** Resolve a wizard answer to a file path, or null when invalid. */
export function pickCandidate(answer: string, candidates: string[]): string | null {
  const a = answer.trim();
  if (!a && candidates.length > 0) return candidates[0];
  const idx = Number(a);
  if (Number.isInteger(idx) && idx >= 1 && idx <= candidates.length) return candidates[idx - 1];
  if (existsSync(a)) return a;
  return null;
}

/** Best-effort open of a file in the default browser/app. Never throws. */
export function openInBrowser(path: string): void {
  try {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* the run summary prints the path either way */
  }
}

export async function runWizard(cwd: string = process.cwd()): Promise<PipelineSummary> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Kasuwright — BRD nunchi full test lifecycle, automatic ga.");
    console.log("Meeru cheyalsindi 2 steps matrame.\n");

    // Step 1 — the BRD
    const candidates = findBrdCandidates(cwd);
    let brdPath: string | null = null;
    if (candidates.length > 0) {
      console.log("Step 1: BRD file select cheyandi:");
      candidates.slice(0, 9).forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
      console.log("  (vere file ayithe daani path type cheyandi)");
      const answer = await rl.question("Number (default 1): ");
      brdPath = pickCandidate(answer, candidates);
    } else {
      const answer = await rl.question("Step 1: BRD file path ivvandi: ");
      brdPath = pickCandidate(answer, []);
    }
    if (!brdPath) {
      throw new Error("BRD file dorakaledu. File path correct ga ivvandi, leka BRD unna folder nunchi run cheyandi.");
    }

    // Step 2 — project key, Enter is enough
    const keyAnswer = await rl.question("Step 2: Jira project key (default QA) — Enter kotandi: ");
    const projectKey = keyAnswer.trim() || "QA";

    console.log("\nAnthe — inka motham automatic. Run avuthundi...\n");
    const outDir = join(cwd, "runs", "latest");
    const summary = await runPipeline({ brdPath, outDir, projectKey, llm: llmFromEnv() });

    console.log(`\nAyyindi -> ${summary.outDir}`);
    for (const s of summary.stages) console.log(`  ${s.name}: ${s.detail}`);
    const report = join(outDir, "report.html");
    console.log(`\nReport: ${report} (browser lo open avuthundi)`);
    openInBrowser(report);
    return summary;
  } finally {
    rl.close();
  }
}
