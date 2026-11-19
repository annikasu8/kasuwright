#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates, type ElementHints } from "./healer.js";
import { analyzeToFile } from "./analyze.js";
import { runPipeline } from "./pipeline.js";
import { llmFromEnv } from "./llm.js";
import { analyzeFailureLLM } from "./llm-features.js";
import { runWizard } from "./wizard.js";

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
    console.log("Kasuwright: interactive wizard ki terminal kavali. CI/scripts kosam: kasuwright pipeline --brd <BRD.md>");
  }
  if (cmd === "pipeline") {
    const brd = flag("brd");
    if (!brd) {
      console.error("Usage: kasuwright pipeline --brd <BRD.md> [--out runs/latest] [--project QA]");
      process.exit(2);
    }
    const llm = llmFromEnv();
    console.log(llm ? `LLM: enabled (${llm.model})` : "LLM: not configured — deterministic engines only (set KASUWRIGHT_LLM_API_KEY to enable)");
    const summary = await runPipeline({
      brdPath: brd,
      outDir: flag("out") ?? join(process.cwd(), "runs", "latest"),
      projectKey: flag("project") ?? "QA",
      llm,
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
