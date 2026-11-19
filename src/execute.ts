/**
 * v0.7 — Execution with screenshot evidence.
 *
 * Runs the generated test cases in a real browser (Playwright, loaded
 * dynamically — it is a peer dependency of every Playwright project) and
 * captures a screenshot after EVERY step: open URL, fill a field, click a
 * button. Manual testers get step-by-step proof, compiled into an Excel
 * evidence workbook by evidence.ts.
 *
 * Element resolution is best-effort and layered (label -> placeholder ->
 * role -> text -> input attributes), mirroring how the generated specs
 * locate elements. A step that cannot be performed stops its case; a
 * verify step that cannot be auto-checked is recorded as "check" with
 * the screenshot attached for manual review — never silently passed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TestCase, TestStep } from "./testcases.js";

export interface StepRecord {
  n: number;
  action: string;
  target: string;
  detail: string;
  expected?: string;
  status: "pass" | "fail" | "skip" | "check";
  screenshot?: string; // absolute path to the PNG, when captured
}
export interface CaseExecution {
  caseId: string;
  reqId: string;
  title: string;
  status: "pass" | "fail" | "partial";
  steps: StepRecord[];
}
export interface ExecuteOptions {
  baseUrl: string;
  data: Record<string, unknown>;
  outDir: string; // evidence folder
}

async function loadChromium(): Promise<any | null> {
  for (const mod of ["playwright", "@playwright/test"]) {
    try {
      const m: any = await import(mod);
      if (m.chromium) return m.chromium;
    } catch { /* try the next one */ }
  }
  return null;
}

function resolveValue(v: string | undefined, data: Record<string, unknown>): string {
  if (!v) return "";
  const m = v.match(/^\$\{(.+)\}$/);
  if (!m) return v;
  let cur: unknown = data;
  for (const part of m[1].split(".")) cur = (cur as Record<string, unknown>)?.[part];
  return typeof cur === "string" ? cur : "";
}

async function tryFill(page: any, label: string, value: string): Promise<string | null> {
  const attempts: Array<[string, () => Promise<void>]> = [
    ["label", async () => page.getByLabel(label, { exact: false }).first().fill(value, { timeout: 3000 })],
    ["placeholder", async () => page.getByPlaceholder(label, { exact: false }).first().fill(value, { timeout: 3000 })],
    ["input name/id", async () => page.locator(`input[name*="${label.toLowerCase().replace(/[^a-z]/g, "")}" i], input[id*="${label.toLowerCase().replace(/[^a-z]/g, "")}" i]`).first().fill(value, { timeout: 3000 })],
    ["any input", async () => page.locator("input:not([type=hidden]):not([type=submit]):not([type=button])").nth(label.toLowerCase().includes("pass") ? 1 : 0).fill(value, { timeout: 3000 })],
  ];
  for (const [how, fn] of attempts) {
    try { await fn(); return how; } catch { /* next strategy */ }
  }
  return null;
}

async function tryClick(page: any, target: string): Promise<string | null> {
  const attempts: Array<[string, () => Promise<void>]> = [
    ["button role", async () => page.getByRole("button", { name: target, exact: false }).first().click({ timeout: 3000 })],
    ["link role", async () => page.getByRole("link", { name: target, exact: false }).first().click({ timeout: 3000 })],
    ["text", async () => page.getByText(target, { exact: false }).first().click({ timeout: 3000 })],
    ["submit input", async () => page.locator('input[type=submit], button[type=submit]').first().click({ timeout: 3000 })],
  ];
  for (const [how, fn] of attempts) {
    try { await fn(); return how; } catch { /* next strategy */ }
  }
  return null;
}

export async function executeCases(cases: TestCase[], opts: ExecuteOptions): Promise<CaseExecution[] | null> {
  const uiCases = cases.filter((c) => c.steps.some((s) => ["navigate", "enter", "click", "verify"].includes(s.do)));
  const executions: CaseExecution[] = [];
  let browser: any = null;
  let chromium: any = null;

  const ensureBrowser = async (): Promise<boolean> => {
    if (browser) return true;
    chromium = await loadChromium();
    if (!chromium) return false;
    browser = await chromium.launch({ headless: true });
    return true;
  };

  mkdirSync(opts.outDir, { recursive: true });

  for (const c of cases) {
    const exec: CaseExecution = { caseId: c.id, reqId: c.reqId, title: c.title, status: "pass", steps: [] };
    executions.push(exec);
    if (!uiCases.includes(c)) {
      c.steps.forEach((s, i) => exec.steps.push({ n: i + 1, action: s.do, target: s.target, detail: "API/DB step — covered by the API runner / SQL pack; no browser screenshot.", expected: s.expected, status: "skip" }));
      exec.status = "partial";
      continue;
    }
    if (!(await ensureBrowser())) return null; // Playwright unavailable — caller reports it
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    let stopped = false;
    let navigated = false;
    let lastUrl = "";

    for (let i = 0; i < c.steps.length; i++) {
      const s: TestStep = c.steps[i];
      const rec: StepRecord = { n: i + 1, action: s.do, target: s.target, detail: "", expected: s.expected, status: "pass" };
      exec.steps.push(rec);
      if (stopped) {
        rec.status = "skip";
        rec.detail = "Not reached — an earlier step failed.";
        continue;
      }
      try {
        if (s.do === "navigate") {
          let url: string;
          if (s.target.startsWith("http")) url = s.target;
          else if (!navigated) url = opts.baseUrl; // first navigation: the app URL exactly as given
          else {
            const origin = new URL(opts.baseUrl).origin;
            url = origin + (s.target.startsWith("/") ? s.target : "/" + s.target);
          }
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          navigated = true;
          lastUrl = page.url();
          rec.detail = `Opened ${page.url()}`;
        } else if (s.do === "enter") {
          const value = resolveValue(s.value, opts.data);
          const how = await tryFill(page, s.target, value);
          if (!how) throw new Error(`field "${s.target}" not found`);
          const shown = /pass/i.test(s.target) ? "••••••" : value;
          rec.detail = `Entered "${s.target}" via ${how} = ${shown}`;
        } else if (s.do === "click") {
          const how = await tryClick(page, s.target);
          if (!how) throw new Error(`"${s.target}" not clickable / not found`);
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          rec.detail = `Clicked "${s.target}" via ${how} -> ${page.url()}`;
          lastUrl = page.url();
        } else if (s.do === "verify") {
          const bodyText: string = await page.locator("body").innerText().catch(() => "");
          const needle = s.target.toLowerCase();
          if (bodyText.toLowerCase().includes(needle) || page.url() !== lastUrl) {
            rec.detail = `Verified: "${s.target}" ${bodyText.toLowerCase().includes(needle) ? "visible on page" : "— page changed to " + page.url()}`;
          } else {
            rec.status = "check";
            rec.detail = `Could not auto-verify "${s.target}" — screenshot attached for manual check. Expected: ${s.expected ?? s.target}`;
          }
        } else {
          rec.status = "skip";
          rec.detail = "API/DB step — covered by the API runner / SQL pack; no browser screenshot.";
        }
      } catch (e) {
        rec.status = "fail";
        rec.detail = `FAILED: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
        stopped = true;
      }
      // Screenshot after every browser step — the proof manual testers asked for.
      if (["navigate", "enter", "click", "verify"].includes(s.do) && rec.status !== "skip") {
        const shot = join(opts.outDir, `${c.id.toLowerCase()}-step-${i + 1}.png`);
        try {
          await page.screenshot({ path: shot, fullPage: false });
          rec.screenshot = shot;
        } catch { /* page may have closed; evidence row still records the step */ }
      }
    }
    exec.status = exec.steps.some((x) => x.status === "fail") ? "fail" : exec.steps.some((x) => x.status === "check" || x.status === "skip") ? "partial" : "pass";
    await context.close().catch(() => {});
  }

  if (browser) await browser.close().catch(() => {});
  return executions;
}
