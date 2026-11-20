#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates, type ElementHints } from "./healer.js";
import { analyzeToFile } from "./analyze.js";
import { runPipeline } from "./pipeline.js";
import { llmFromEnv } from "./llm.js";
import { analyzeFailureLLM } from "./llm-features.js";
import { runWizard } from "./wizard.js";
import { startUi } from "./ui.js";
import { jiraConfigFromEnv, type JiraConfig } from "./jira.js";
import { SCHEDULES, isScheduleKey, type ScheduleKey } from "./cicd.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (!cmd || cmd === "start") {
    // The 2-step wizard is the default experience. In non-interactive
    // shells (CI, pipes) fall through to usage instead of hanging.
    if (process.stdin.isTTY) {
      await runWizard();
      return;
    }
    console.log("Kasuwright: the interactive wizard needs a terminal. For CI/scripts use: kasuwright pipeline --brd <BRD.md>");
  }
  if (cmd === "ui") {
    await startUi(process.cwd());
    return;
  }
  if (cmd === "pipeline") {
    const brd = flag("brd");
    const ticket = flag("jira-ticket");
    if (!brd && !ticket) {
      console.error("Usage: kasuwright pipeline --brd <BRD.md> [--out runs/latest] [--project QA]\n   or: kasuwright pipeline --jira-ticket KAN-4 [--out runs/latest] [--url <app-url>]  (needs JIRA_* env)");
      process.exit(2);
    }
    const llm = llmFromEnv();
    console.log(llm ? `LLM: enabled (${llm.model})` : "LLM: not configured — deterministic engines only (set KASUWRIGHT_LLM_API_KEY to enable)");
    let jiraTicket: { cfg: JiraConfig; key: string } | undefined;
    if (ticket) {
      const cfg = jiraConfigFromEnv();
      if (!cfg) {
        console.error("--jira-ticket needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN set in the environment.");
        process.exit(2);
      }
      jiraTicket = { cfg, key: ticket.toUpperCase() };
    }
    let jenkins: { schedule: ScheduleKey } | null = null;
    const jenkinsFlag = flag("jenkins");
    if (jenkinsFlag !== undefined) {
      const key = (jenkinsFlag || "nightly").toLowerCase();
      if (!isScheduleKey(key)) {
        console.error(`--jenkins schedule must be one of: ${Object.keys(SCHEDULES).join(", ")}`);
        process.exit(2);
      }
      jenkins = { schedule: key };
    }
    const summary = await runPipeline({
      brdPath: brd ?? undefined,
      jiraTicket,
      outDir: flag("out") ?? join(process.cwd(), "runs", "latest"),
      projectKey: flag("project") ?? "QA",
      llm,
      execute: flag("url") ? { baseUrl: flag("url")! } : null,
      jenkins,
    });
    console.log(`\nKasuwright E2E pipeline complete -> ${summary.outDir}`);
    for (const s of summary.stages) console.log(`  ${s.name}: ${s.detail}`);
    return;
  }
  if (cmd === "llm-check") {
    const llm = llmFromEnv();
    if (!llm) {
      console.log("LLM not configured. Set KASUWRIGHT_LLM_API_KEY (and optionally KASUWRIGHT_LLM_MODEL, KASUWRIGHT_LLM_BASE_URL for any OpenAI-compatible endpoint). All features still work with the deterministic engines.");
      return;
    }
    const reply = await llm.chat([{ role: "user", content: "Reply with the single word: ready" }]);
    console.log(`LLM reachable: provider=${llm.name} model=${llm.model} reply="${reply.trim().slice(0, 40)}"`);
    return;
  }
  if (cmd === "explain") {
    const errFile = args[0];
    if (!errFile) {
      console.error("Usage: kasuwright explain <error.txt> [dom.html]");
      process.exit(2);
    }
    const llm = llmFromEnv();
    if (!llm) {
      console.error("The failure analyst needs an LLM: set KASUWRIGHT_LLM_API_KEY. (The rule-based `analyze` command works without one.)");
      process.exit(2);
    }
    const analysis = await analyzeFailureLLM(
      {
        testTitle: flag("title") ?? "unknown test",
        error: readFileSync(errFile, "utf8"),
        domSnippet: args[1] ? readFileSync(args[1], "utf8") : undefined,
      },
      llm,
    );
    if (!analysis) {
      console.error("The LLM returned nothing usable for this error.");
      process.exit(1);
    }
    console.log(`Root cause (${analysis.confidence} confidence): ${analysis.rootCause}`);
    for (const e of analysis.evidence) console.log(`  evidence: ${e}`);
    console.log(`Suggested fix: ${analysis.suggestedFix}`);
    return;
  }
  if (cmd === "analyze") {
    const history = args[0] ?? join(process.cwd(), ".kasuwright", "history.jsonl");
    const out = args[1] ?? join(process.cwd(), ".kasuwright", "report.md");
    const report = analyzeToFile(history, out);
    console.log(report);
    console.error(`Report written to ${out}`);
    return;
  }
  if (cmd === "heal") {
    const [htmlFile, hintsFile, outFile] = args;
    if (!htmlFile || !hintsFile) {
      console.error("Usage: kasuwright heal <page.html> <hints.json> [suggestions.json]");
      process.exit(2);
    }
    const html = readFileSync(htmlFile, "utf8");
    const hints = JSON.parse(readFileSync(hintsFile, "utf8")) as ElementHints;
    const candidates = findCandidates(html, hints);
    const suggestion = {
      originalSelector: hints.originalSelector ?? null,
      generatedAt: new Date().toISOString(),
      status: "PENDING_APPROVAL — Kasuwright never edits tests silently",
      candidates,
    };
    const out = outFile ?? "heal-suggestions.json";
    writeFileSync(out, JSON.stringify(suggestion, null, 2));
    console.log(`Top candidate score ${candidates[0]?.score ?? 0}: ${candidates[0]?.locators[0] ?? "none"}`);
    console.error(`Suggestions written to ${out} for human approval.`);
    return;
  }
  console.log(`Kasuwright — E2E test lifecycle automation for Playwright teams

Commands:
  kasuwright                                       2-step wizard (BRD select -> Enter -> done)
  kasuwright ui                                    Web UI in the browser — no terminal skills needed
  kasuwright pipeline --brd <BRD.md> [--out dir] [--project KEY]
      BRD -> Jira -> test cases -> test data -> framework -> automation
      -> traceability -> report -> email -> CI files
  kasuwright analyze [history.jsonl] [report.md]   Suite health + flaky report
  kasuwright heal <page.html> <hints.json> [out]   Find what a broken locator meant
  kasuwright explain <error.txt> [dom.html]        LLM failure analyst (needs KASUWRIGHT_LLM_API_KEY)
  kasuwright llm-check                             Verify the configured LLM endpoint
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
