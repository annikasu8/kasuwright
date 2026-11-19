import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export interface RunRecord {
  ts: string;
  file: string;
  title: string;
  status: string;
  durationMs: number;
  error?: string;
}

/**
 * Playwright reporter that appends one JSON line per test result to
 * .healwright/history.jsonl — the data source for `healwright analyze`.
 *
 * Usage in playwright.config.ts:
 *   reporter: [["healwright/reporter"], ["list"]]
 */
export default class HealwrightReporter implements Reporter {
  private outDir: string;

  constructor(options: { outDir?: string } = {}) {
    this.outDir = options.outDir ?? join(process.cwd(), ".healwright");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const firstError = result.errors?.[0]?.message ?? result.error?.message;
    const rec: RunRecord = {
      ts: new Date().toISOString(),
      file: test.location.file,
      title: test.titlePath().join(" > "),
      status: result.status,
      durationMs: Math.round(result.duration),
      ...(firstError ? { error: firstError.split("\n").slice(0, 4).join("\n") } : {}),
    };
    mkdirSync(this.outDir, { recursive: true });
    appendFileSync(join(this.outDir, "history.jsonl"), JSON.stringify(rec) + "\n");
  }
}
