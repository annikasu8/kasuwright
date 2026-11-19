# Kasuwright

**Self-healing locators and failure analysis for Playwright suites.**

UI changed, test broke, sprint slowed down — Kasuwright finds what your broken
locator *meant*, explains why tests fail, and flags flaky tests before they
erode trust in the suite. It never edits a test silently: every heal is a
suggestion a human approves.

## What works today (v0.1)

- **Healing engine** — captures "hints" about the element a selector pointed at
  (tag, text, role, attributes) while the test passes; after a redesign it
  scores every element on the new page and returns ranked replacement locators
  with the reasons for each match.
- **Playwright helpers** — `captureHints(page, selector)` and
  `healLocator(page, hints)` plug into a real Playwright project.
- **Reporter** — a Playwright reporter that records every test result to
  `.kasuwright/history.jsonl`.
- **Analyzer CLI** — `kasuwright analyze` turns that history into a suite
  health report: flaky tests (passed *and* failed across runs) first, then
  consistent failures, each with a plain-language likely cause.


## Quick start — 2 steps, nothing to learn

```bash
npx kasuwright
```

Step 1: pick your BRD file (Kasuwright finds it in the folder automatically).
Step 2: press Enter.

Everything else is automatic: Jira tickets (with acceptance criteria), test
cases, test data, the Playwright framework, automation specs, traceability,
the HTML report (opens in your browser), the email draft and the CI files.
When Jira is connected, the loop closes itself: the run posts a comment on
each ticket and attaches the manual scenarios sheet, the test data, the
automation spec and the report to the ticket. Power users and
CI can still drive every stage with flags — see `kasuwright pipeline --help`.

**Prefer a web page over the terminal? (v0.6)**

```bash
npx kasuwright ui
```

A page opens in your browser: drop in the BRD file, fill the Jira form once
(saved on your own machine), press RUN, watch the stages live, and open the
report — no terminal skills needed.

**Screenshot evidence for manual testers (v0.7):** tick "Run the tests in a
browser" in the UI (or pass `--url <app-url>` to the pipeline) and
Kasuwright executes the generated cases in a real browser, captures a
screenshot at **every step** — open URL, fill field, click button — and
builds **evidence.xlsx**: a Summary sheet plus one sheet per test case with
step descriptions, statuses and the screenshots embedded. The workbook is
also attached to the Jira Story. One-time setup in the project:
`npm i -D @playwright/test && npx playwright install chromium`.

## The E2E pipeline (v0.2)

One command runs the whole test lifecycle:

```bash
npx kasuwright pipeline --brd docs/BRD.md --out runs/latest --project QA
```

1. **BRD intake** — parses requirements + acceptance criteria from the BRD
2. **Jira** — one Story + QA sub-task per requirement (REST payloads + CSV
   import; created directly when `JIRA_*` env vars are set)
3. **Manual test cases** — positive / negative / boundary per requirement,
   written for human review before automation
4. **Test data** — synthetic PII-safe data sets (JSON / CSV / SQL)
5. **Flows** — UI (Playwright), API (fetch runner), DB (validation SQL)
6. **Framework creation** — a ready-to-run Playwright project scaffold
7. **Automation compilation** — manual cases compiled into Playwright specs
8. **Execution + healing** — the reporter records runs; the healer repairs
   broken locators as suggestions a human approves
9. **Reports** — suite health + a **Requirements Traceability Matrix**
   (BRD → Jira → cases → scripts → status) as Markdown and HTML
10. **Email** — the report as a ready `.eml`; sent automatically when
    `SMTP_*` env vars are set
11. **CI/CD** — a Jenkinsfile and a GitHub Actions workflow are generated
    with the run; failing tests produce auto-defect Jira payloads

## Quick start

```bash
npm install
npm run build
npm run demo     # watch a locator heal after a page redesign
npm test         # unit tests for the engine + analyzer
```

Use the reporter in `playwright.config.ts`:

```ts
reporter: [["kasuwright/reporter"], ["list"]]
```

Then after a few runs:

```bash
npx kasuwright analyze
```

## Roadmap

- v0.2 — LLM-assisted healing for ambiguous matches + failure analyst that
  reads Playwright traces and screenshots
- v0.3 — GitHub Actions / Jenkins apps that open *approval PRs* with the fix
- v1.0 — hosted dashboard: run history, healing suggestions, flake trends

## License

MIT

## LLM layer (v0.3, optional)

Kasuwright works fully offline with deterministic engines. Add an LLM and
three stages get smarter — each with automatic fallback if the model call
fails or returns unusable output:

- **BRD understanding** — extracts requirements from unstructured prose BRDs
  (no REQ-IDs needed) and merges them with the deterministic parse.
- **AI test-case design** — richer positive/negative/boundary cases in the
  same semantic step format, so they still compile to Playwright specs.
- **Failure analyst** — `kasuwright explain <error.txt> [dom.html]` reads a
  Playwright error + DOM snapshot and returns root cause, evidence and a fix.

Any OpenAI-compatible endpoint works (OpenAI, Azure, Ollama, OpenRouter):

```bash
export KASUWRIGHT_LLM_API_KEY=sk-...
export KASUWRIGHT_LLM_MODEL=gpt-4o-mini        # optional
export KASUWRIGHT_LLM_BASE_URL=https://api.openai.com/v1   # optional
npx kasuwright llm-check
```
