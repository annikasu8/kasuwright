# Kasuwright — Knowledge Transfer (KT) Document

**Product:** Kasuwright (Kasu + Playwright) — AI-ready test automation toolkit
**Owner / Author:** Anil Kasarla (annikasu8@gmail.com)
**Current version:** 0.9.0 (19 Nov 2026)
**License:** MIT (open core)
**Links:** npm — https://www.npmjs.com/package/kasuwright · GitHub — https://github.com/annikasu8/kasuwright

---

## 1. Product overview

Kasuwright does two jobs for QA / SDET teams:

1. **Self-healing Playwright tests** — when a UI change breaks a locator, Kasuwright analyses the old element hints against the new page, ranks candidate elements with reasons, and proposes the fixed locator. A human approves before anything changes.
2. **A full E2E test-lifecycle pipeline** — from one BRD document it generates Jira tickets, manual test cases, test data, a Playwright automation framework, executable specs, a requirements traceability matrix, an HTML report, an email draft and CI files.

**The product goal (set by the owner, 19 Nov 2026): the user should need to know nothing.** Running the tool is two steps — pick the BRD, press Enter — and everything else is automatic. Flags and environment variables exist only for CI and power users.

**Who buys it:** QA Managers and Engineering Directors at 50–500-person SaaS companies; QA services firms buying seats in bulk. Model: open-source core (free, MIT) + paid cloud/LLM tiers planned (Pro ~$49, Team ~$79 per user/month).

## 2. Requirements

### 2.1 Functional requirements

| # | Requirement | Where it lives |
|---|---|---|
| FR-1 | Parse a BRD (Markdown/text) into requirements — IDs (REQ-/FR-/BR-/US-), user stories, "system shall" statements, heading sections | `src/brd.ts` |
| FR-2 | Generate one Jira Story + one QA sub-task per requirement; export REST v3 payloads + bulk-import CSV; create issues for real only when Jira credentials are configured | `src/jira.ts` |
| FR-3 | Generate manual test cases per requirement (positive, negative, boundary) with semantic steps; flow templates for login, payment, search, register | `src/testcases.ts` |
| FR-4 | Generate synthetic test data (valid / invalid / empty / boundary) as JSON + CSV + SQL; PII-safe samples only | `src/testdata.ts` |
| FR-5 | Scaffold a runnable Playwright framework and compile manual cases into executable spec files | `src/codegen.ts` |
| FR-6 | Run API scenarios (fetch-based) including login flows | `src/apirun.ts` |
| FR-7 | Produce a Requirements Traceability Matrix (BRD → Jira → cases → spec → status), an HTML run report, auto-defect Jira payloads from failures, and an email report (.eml; SMTP send only when configured) | `src/enterprise.ts` |
| FR-8 | Generate Jenkinsfile and GitHub Actions workflow for the generated suite | `src/ci.ts` |
| FR-9 | Orchestrate the whole lifecycle in one command | `src/pipeline.ts` |
| FR-10 | Self-healing: score candidate elements (data-testid 100, id 90, exact text 60, aria-label 40, role 30, similar id 25, shared classes 5 each) and suggest Playwright locators; suggestions saved as PENDING_APPROVAL, never applied silently | `src/healer.ts`, `src/playwright.ts` |
| FR-11 | Record test-run history and flag flaky tests (same test passing and failing across runs) with a plain-language diagnosis and a Markdown suite-health report | `src/reporter.ts`, `src/analyze.ts` |
| FR-12 | Optional LLM layer (any OpenAI-compatible endpoint): extract requirements from unstructured BRDs, design extra test cases, explain failures. Must fall back to the deterministic engines when no key is set or a call fails | `src/llm.ts`, `src/llm-features.ts` |
| FR-14 | Jira loop closure: after a run with Jira connected, post an automatic comment on each created Story and attach the manual scenarios sheet, test data, automation spec, report.html and traceability matrix to the ticket | `src/jira.ts`, `src/pipeline.ts` |
| FR-15 | Local web UI: `kasuwright ui` serves a browser page on 127.0.0.1 — BRD drag-and-drop or folder pick, Jira connect form (validated with a test-connection call, saved only in ~/.kasuwright/config.json, token never returned to the page), RUN with live stage progress, Jira links and the HTML report | `src/ui.ts` |
| FR-16 | Execution evidence: with an app URL, execute the generated cases in a real browser (Playwright loaded dynamically), screenshot every step, and build evidence.xlsx (Summary + one sheet per case, descriptions + statuses + embedded screenshots); attached to the first Jira Story | `src/execute.ts`, `src/evidence.ts`, `src/pipeline.ts` |
| FR-17 | Ticket-first intake: fetch a Jira issue (ADF description → plain text), extract its acceptance criteria, download attachments (BRD docs add requirements; CSV/JSON kept as provided mock data); create a QA sub-task under the ticket and publish all results back onto the same ticket | `src/jira-intake.ts`, `src/jira.ts`, `src/pipeline.ts` |
| FR-18 | Scheduled Jenkins pack (opt-in): Jenkinsfile with cron trigger + result emails, importable job-config.xml (TimerTrigger + embedded CpsFlowDefinition script), README-jenkins.md setup guide; presets nightly / weekdays / every6h / weekly | `src/cicd.ts`, `src/pipeline.ts` |
| FR-13 | Zero-knowledge wizard: bare `kasuwright` auto-detects BRD files in the folder, asks only (1) which file and (2) project key (Enter = default), runs the pipeline and opens report.html | `src/wizard.ts` |

### 2.2 Non-functional requirements

- **Deterministic first, LLM second.** Every feature works with no API key and no network beyond package install.
- **Nothing is sent silently.** Jira creation, email sending and locator changes all require explicit configuration or human approval.
- **Privacy:** healing works from DOM snapshots and traces; customer source code is never required or uploaded.
- **Runs anywhere Node 18+ runs** (Windows, macOS, Linux). No install needed via `npx`.
- **Tests:** 13 automated tests, all passing at v0.4.0 (healer, pipeline, LLM layer with a mock provider, wizard).

## 3. Architecture

TypeScript / Node, compiled with `tsc` to `dist/`. One runtime dependency (`linkedom`) for DOM parsing in the healing engine.

```
BRD ──> brd.ts ──> requirements ──┬─> jira.ts ───────> Jira payloads / live issues
                                  ├─> testcases.ts ──> manual cases ──> codegen.ts ──> Playwright specs
                                  ├─> testdata.ts ───> JSON / CSV / SQL data sets
                                  └─> enterprise.ts ─> traceability + report.html + defects + .eml
pipeline.ts orchestrates all stages; wizard.ts is the 2-step front door; cli.ts exposes commands.
playwright.ts + reporter.ts plug into a user's existing Playwright suite for healing + flake history.
llm.ts / llm-features.ts optionally enrich stages 1, 3 and failure analysis.
```

## 4. How a user runs it

**The 2-step way (the product):**

```bash
npx kasuwright
# Step 1: pick the BRD (auto-detected in the current folder)
# Step 2: press Enter
```

**Power-user / CI commands:**

| Command | Purpose |
|---|---|
| `kasuwright pipeline --brd <file> [--out dir] [--project KEY]` | Full E2E pipeline without prompts |
| `kasuwright demo` | Self-healing demo (before/after page redesign) |
| `kasuwright analyze` | Flaky-test and suite-health report from run history |
| `kasuwright llm-check` | Show whether the LLM layer is configured |
| `kasuwright explain <error.txt> [dom.html]` | AI failure analysis (needs a key) |

**Configuration (all optional, environment variables):** `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (live Jira creation); `SMTP_HOST`, `SMTP_FROM`, `REPORT_EMAIL_TO` (email sending); `KASUWRIGHT_LLM_API_KEY`, `KASUWRIGHT_LLM_MODEL`, `KASUWRIGHT_LLM_BASE_URL` (LLM layer).

**Outputs of a pipeline run** (in the chosen out folder): `requirements.json`, `jira/`, `test-cases.json` + `test-cases.md`, `test-data/`, `framework/`, `traceability.md`, `report.html`, `report.eml`, `defects.json`, `run-summary.json`, `Jenkinsfile`, `.github/workflows/`.

## 5. Release process (how a version ships)

1. Bump the version in `package.json` and `package-lock.json`; `npm run build`; `npm test` (must be all green).
2. Upload changed files to the GitHub repo (web upload, commit per batch).
3. Build the npm payload: `npm pack`, then `node build-publish-payload.mjs`.
4. Publish through the npm connector helper: `python3 ~/workspace/custom-connectors/custom.npm/bin/npm_api.py publish publish-payload.json` — expect HTTP 202 (staged).
5. The owner approves the staged version on npmjs.com → Staged Packages.
6. Verify: `npm view kasuwright version` and a real `npx kasuwright` run on a clean machine.

## 6. Version history

| Version | Date | What shipped |
|---|---|---|
| 0.1.0 | 19 Nov 2026 | Healing engine, Playwright reporter, flake analysis, demo |
| 0.2.0 | 19 Nov 2026 | Full E2E pipeline (BRD → Jira → cases → data → framework → specs → traceability → report → email → CI) |
| 0.3.0 | 19 Nov 2026 | Optional LLM layer (`explain`, `llm-check`), first npm release |
| 0.4.0 | 19 Nov 2026 | 2-step wizard as the default experience; report auto-opens |
| 0.5.0 | 19 Nov 2026 | Jira loop closure — tickets carry acceptance criteria; runs auto-comment and attach artefacts back to the ticket (verified against a mock Jira) |
| 0.5.1 | 19 Nov 2026 | Jira issue types resolved from the project's createmeta (team-managed Task/Subtask projects work) — bug found by the first external tester |
| 0.5.2 | 19 Nov 2026 | Sub-tasks are created with their parent Story key (real Jira requires it) |
| 0.6.0 | 19 Nov 2026 | Local web UI (`kasuwright ui`) — BRD drag-and-drop, one-time Jira form saved locally, live stage progress, report in the browser; no terminal skills needed |
| 0.6.1 | 19 Nov 2026 | All UI and wizard text in English |
| 0.6.2 | 19 Nov 2026 | Report email defaults to annikasu8@gmail.com; editable in the UI |
| 0.7.0 | 19 Nov 2026 | Execution evidence — browser run with a screenshot at every step and an Excel evidence workbook (verified end-to-end against a live login page) |
| 0.8.0 | 19 Nov 2026 | Ticket-first runs — start from an existing Jira ticket key: acceptance criteria + attached BRD/mock data drive the run; QA sub-task created under the ticket; results published back onto the same ticket |
| 0.9.0 | 19 Nov 2026 | Optional scheduled Jenkins CI/CD pack (UI checkbox / `--jenkins <preset>`): Jenkinsfile with cron trigger, importable job-config.xml with embedded script, setup guide; 4 schedule presets |

## 7. Business status and next steps

- **Done:** blueprint, v0.1–v0.4 built and tested, GitHub repo public, npm live, landing page (2-step story), founder self-test on a clean Mac (2 Enters → report opened).
- **Next (in order):** (1) validation — 5 QA-lead conversations in 7 days using the plan in `validation-plan.md`, with the copy-paste tester invite; success = 3+ confirm the pain and name ≥ $30/user/month or accept a pilot. (2) English UI + wizard text — done in v0.6.1. (3) Demo video. (4) Launch posts (Product Hunt, LinkedIn, Playwright community) after validation. (5) Optional: landing page on GitHub Pages / kasuwright.com.
- **Guardrails:** paid cloud/LLM code stays private (only the open core is published); consult an immigration attorney before monetising (owner is on H1B).

## 8. Known limitations

- Wizard and UI text were Tanglish up to v0.6.0; English from v0.6.1 (at the founder's direction).
- Jira/email act only in export mode until the user sets the environment variables in section 4.
- BRD parsing is tuned for Markdown/text documents with requirement IDs or user-story phrasing; scanned PDFs are not parsed yet.
- Healing suggestions are advisory — a human approves each one (by design).

## 9. Support and ownership

- Owner and maintainer: Anil Kasarla — annikasu8@gmail.com
- Issues and stars: https://github.com/annikasu8/kasuwright
- This KT reflects the code and release state verified on 19 Nov 2026.
