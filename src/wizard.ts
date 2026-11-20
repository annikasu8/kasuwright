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
import { jiraConfigFromEnv, type JiraConfig } from "./jira.js";

/** A Jira ticket key typed at Step 1 (e.g. KAN-4) starts a ticket-first run. */
const TICKET_KEY = /^[A-Za-z][A-Za-z0-9_]+-\d+$/;

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
    console.log("Kasuwright — from BRD to the full test lifecycle, automatically.");
    console.log("You only do 2 steps.\n");

    // Step 1 — the BRD, or a Jira ticket key to start from an existing ticket
    const candidates = findBrdCandidates(cwd);
    let brdPath: string | null = null;
    let jiraTicket: { cfg: JiraConfig; key: string } | undefined;
    let step1Answer = "";
    if (candidates.length > 0) {
      console.log("Step 1: Choose your BRD file:");
      candidates.slice(0, 9).forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
      console.log("  (for a different file, type its path — or type a Jira ticket key like KAN-4)");
      step1Answer = await rl.question("Number (default 1): ");
      brdPath = pickCandidate(step1Answer, candidates);
    } else {
      step1Answer = await rl.question("Step 1: Enter the BRD file path (or a Jira ticket key like KAN-4): ");
      brdPath = pickCandidate(step1Answer, []);
    }
    if (!brdPath && TICKET_KEY.test(step1Answer.trim())) {
      const cfg = jiraConfigFromEnv();
      if (!cfg) {
        throw new Error("Ticket-first runs need Jira credentials: set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN, or use the web UI (kasuwright ui) and type them once.");
      }
      jiraTicket = { cfg, key: step1Answer.trim().toUpperCase() };
      console.log(`Starting from Jira ticket ${jiraTicket.key} — its acceptance criteria and attachments drive the run.`);
    }
    if (!brdPath && !jiraTicket) {
      throw new Error("BRD file not found. Enter the correct path, or run Kasuwright from the folder that contains the BRD.");
    }

    // Step 2 — project key, Enter is enough (skipped for ticket runs: the
    // project comes from the ticket key itself)
    let projectKey = "QA";
    if (!jiraTicket) {
      const keyAnswer = await rl.question("Step 2: Jira project key (default QA) — just press Enter: ");
      projectKey = keyAnswer.trim() || "QA";
    }

    console.log("\nThat's it — everything else is automatic. Running...\n");
    const outDir = join(cwd, "runs", "latest");
    const summary = await runPipeline({ brdPath: brdPath ?? undefined, jiraTicket, outDir, projectKey, llm: llmFromEnv() });

    console.log(`\nDone -> ${summary.outDir}`);
    for (const s of summary.stages) console.log(`  ${s.name}: ${s.detail}`);
    const report = join(outDir, "report.html");
    console.log(`\nReport: ${report} (opening in your browser)`);
    openInBrowser(report);
    return summary;
  } finally {
    rl.close();
  }
}
