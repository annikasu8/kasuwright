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
