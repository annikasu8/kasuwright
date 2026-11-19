#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findCandidates, type ElementHints } from "./healer.js";
import { analyzeToFile } from "./analyze.js";
import { runPipeline } from "./pipeline.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (cmd === "pipeline") {
    const brd = flag("brd");
    if (!brd) {
      console.error("Usage: healwright pipeline --brd <BRD.md> [--out runs/latest] [--project QA]");
      process.exit(2);
    }
    const summary = await runPipeline({
      brdPath: brd,
      outDir: flag("out") ?? join(process.cwd(), "runs", "latest"),
      projectKey: flag("project") ?? "QA",
    });
    console.log(`\nHealwright E2E pipeline complete -> ${summary.outDir}`);
    for (const s of summary.stages) console.log(`  ${s.name}: ${s.detail}`);
    return;
  }
  if (cmd === "analyze") {
    const history = args[0] ?? join(process.cwd(), ".healwright", "history.jsonl");
    const out = args[1] ?? join(process.cwd(), ".healwright", "report.md");
    const report = analyzeToFile(history, out);
    console.log(report);
    console.error(`Report written to ${out}`);
    return;
  }
  if (cmd === "heal") {
    const [htmlFile, hintsFile, outFile] = args;
    if (!htmlFile || !hintsFile) {
      console.error("Usage: healwright heal <page.html> <hints.json> [suggestions.json]");
      process.exit(2);
    }
    const html = readFileSync(htmlFile, "utf8");
    const hints = JSON.parse(readFileSync(hintsFile, "utf8")) as ElementHints;
    const candidates = findCandidates(html, hints);
    const suggestion = {
      originalSelector: hints.originalSelector ?? null,
      generatedAt: new Date().toISOString(),
      status: "PENDING_APPROVAL — Healwright never edits tests silently",
      candidates,
    };
    const out = outFile ?? "heal-suggestions.json";
    writeFileSync(out, JSON.stringify(suggestion, null, 2));
    console.log(`Top candidate score ${candidates[0]?.score ?? 0}: ${candidates[0]?.locators[0] ?? "none"}`);
    console.error(`Suggestions written to ${out} for human approval.`);
    return;
  }
  console.log(`Healwright — E2E test lifecycle automation for Playwright teams

Commands:
  healwright pipeline --brd <BRD.md> [--out dir] [--project KEY]
      BRD -> Jira -> test cases -> test data -> framework -> automation
      -> traceability -> report -> email -> CI files
  healwright analyze [history.jsonl] [report.md]   Suite health + flaky report
  healwright heal <page.html> <hints.json> [out]   Find what a broken locator meant
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
