/**
 * The E2E orchestrator — one command runs the whole chain:
 *
 *   BRD -> Jira -> manual test cases -> test data -> framework scaffold
 *   -> automation specs -> traceability -> HTML report -> email -> CI files
 *
 * Every stage writes its artifacts into the run folder, so the run is
 * auditable end to end. Stages that need credentials (Jira push, SMTP)
 * fall back to export mode when env vars are absent — nothing is sent
 * anywhere without configuration.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBrd } from "./brd.js";
import { toJiraIssues, toJiraPayloads, toJiraCsv, jiraConfigFromEnv, pushToJira, publishRunToJira, type JiraPublishFile, type JiraConfig } from "./jira.js";
import { generateTestCases, testCasesToMarkdown } from "./testcases.js";
import { generateDataSet, dataSetToCsv, dataSetToSql } from "./testdata.js";
import { scaffoldFramework } from "./codegen.js";
import { traceability, traceabilityMarkdown, renderHtmlReport, buildEml, smtpConfigFromEnv, sendViaSmtp } from "./enterprise.js";
import { jenkinsfile, githubActions } from "./ci.js";
import type { LlmProvider } from "./llm.js";
import { extractRequirementsLLM, designCasesLLM } from "./llm-features.js";

export interface PipelineOptions {
  brdPath: string;
  outDir: string;
  projectKey?: string;
  llm?: LlmProvider | null;
  /** Explicit Jira config (e.g. from the web UI). Undefined = read env vars; null = export mode. */
  jira?: JiraConfig | null;
  /** Recipient for the report email. Falls back to REPORT_EMAIL_TO, then the default below. */
  reportEmail?: string;
  /** Called as each stage completes (live progress for the web UI). */
  onStage?: (s: StageResult) => void;
}
export interface StageResult { name: string; detail: string }
export interface PipelineSummary { outDir: string; requirements: number; jiraIssues: number; testCases: number; stages: StageResult[]; jiraCreated?: string[] }

export async function runPipeline(opts: PipelineOptions): Promise<PipelineSummary> {
  const projectKey = opts.projectKey ?? "QA";
  const out = opts.outDir;
  mkdirSync(out, { recursive: true });
  const stages: StageResult[] = [];
  const push = (s: StageResult) => { stages.push(s); opts.onStage?.(s); };
  const put = (rel: string, content: string) => {
    const p = join(out, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };

  // 1 — BRD intake (deterministic parser first; the LLM adds requirements
  // from unstructured prose the parser cannot see, when a key is configured)
  const brdText = readFileSync(opts.brdPath, "utf8");
  let reqs = parseBrd(brdText);
  let llmNote = "";
  if (opts.llm) {
    const extra = await extractRequirementsLLM(brdText, opts.llm);
    if (extra) {
      const known = new Set(reqs.map((r) => r.id));
      const added = extra.filter((r) => !known.has(r.id));
      if (reqs.length === 0) reqs = extra;
      else reqs = [...reqs, ...added];
      llmNote = `; LLM (${opts.llm.model}) contributed ${reqs.length === extra.length && added.length === 0 ? extra.length : added.length} requirement(s)`;
    } else {
      llmNote = "; LLM extraction returned nothing usable — deterministic parse kept";
    }
  }
  put("requirements.json", JSON.stringify(reqs, null, 2));
  push({ name: "1. BRD intake", detail: `${reqs.length} requirements parsed (${reqs.map((r) => r.id).join(", ")})${llmNote}` });

  // 2 — Jira
  const issues = toJiraIssues(reqs, projectKey);
  put("jira/jira-payloads.json", JSON.stringify(toJiraPayloads(issues, projectKey), null, 2));
  put("jira/jira-import.csv", toJiraCsv(issues));
  const jiraCfg = opts.jira !== undefined ? opts.jira : jiraConfigFromEnv();
  let createdKeys: string[] = [];
  if (jiraCfg) {
    createdKeys = await pushToJira(issues, projectKey, jiraCfg);
    push({ name: "2. Jira", detail: `Created ${createdKeys.length} issues in ${projectKey}: ${createdKeys.join(", ")}` });
  } else {
    push({ name: "2. Jira", detail: `${issues.length} issues exported (jira-payloads.json + jira-import.csv) — set JIRA_* env to create them directly` });
  }

  // 3 — Manual test cases (LLM-designed when configured, templates otherwise;
  // a failed LLM call falls back per requirement, never blocks the run)
  let cases: ReturnType<typeof generateTestCases>;
  let caseNote = "templates";
  if (opts.llm) {
    cases = [];
    let llmCases = 0;
    for (const r of reqs) {
      const designed = await designCasesLLM(r, opts.llm);
      if (designed) { cases.push(...designed); llmCases += designed.length; }
      else cases.push(...generateTestCases([r]));
    }
    caseNote = llmCases > 0 ? `${llmCases} LLM-designed + ${cases.length - llmCases} template` : "templates (LLM returned nothing usable)";
  } else {
    cases = generateTestCases(reqs);
  }
  put("test-cases.json", JSON.stringify(cases, null, 2));
  const casesMd = testCasesToMarkdown(cases);
  put("test-cases.md", casesMd);
  push({ name: "3. Manual test cases", detail: `${cases.length} cases generated (${caseNote}) — pending human review` });

  // 4 — Test data
  const dataSets = reqs.map((r) => generateDataSet(r));
  const byReq: Record<string, unknown> = {};
  for (const ds of dataSets) {
    byReq[ds.reqId] = ds.rows;
    put(`test-data/${ds.reqId.toLowerCase()}.csv`, dataSetToCsv(ds));
  }
  const emailPw = generateDataSet({ id: "X", title: "login email password", description: "", acceptanceCriteria: [], sourceLine: 0 });
  const validRow = emailPw.rows.find((r) => r.case === "valid")!.values;
  const namedSets = {
    validUser: { email: validRow.email ?? "qa.user@example.com", password: validRow.password ?? "Str0ng!Pass1" },
    newUser: { name: "Asha Verma", email: "new.user@example.com", password: "Str0ng!Pass1" },
    validCard: { number: "4242424242424242", expiry: "12/29", cvv: "123" },
    searchTerm: "running shoes",
    invalidData: "!!invalid!!",
    boundaryData: "x".repeat(100),
    byRequirement: byReq,
  };
  put("test-data/test-data.json", JSON.stringify(namedSets, null, 2));
  const sql = ["-- Kasuwright test-data + DB validation pack", ...dataSets.map((ds) => `-- ${ds.reqId}\n${dataSetToSql(ds)}`)].join("\n");
  push({ name: "4. Test data", detail: `${dataSets.length} synthetic data sets (valid/invalid/empty/boundary) as JSON + CSV + SQL` });

  // 5–7 — Framework scaffold + automation compilation (UI/API/DB flows)
  const byReqCases = new Map<string, { title: string; cases: typeof cases }>();
  for (const r of reqs) byReqCases.set(r.id, { title: r.title, cases: cases.filter((c) => c.reqId === r.id) });
  const scaffold = scaffoldFramework(join(out, "framework"), byReqCases, namedSets, sql);
  push({ name: "5-7. Framework + automation", detail: `Playwright framework scaffolded (${scaffold.files.length} files): specs per requirement, test data, DB validations` });

  // 8 — Traceability + report
  const traceRows = traceability(reqs, issues, cases);
  const traceMd = traceabilityMarkdown(traceRows);
  put("traceability.md", traceMd);
  const html = renderHtmlReport({
    title: `Kasuwright E2E Run — ${projectKey}`,
    generatedAt: new Date().toISOString(),
    stages,
    traceRows,
  });
  put("report.html", html);
  push({ name: "8. Traceability + report", detail: `Matrix covers ${traceRows.length} requirements; report.html generated` });

  // 9 — Email
  const eml = buildEml({
    from: process.env.SMTP_FROM ?? "kasuwright@localhost",
    to: opts.reportEmail ?? process.env.REPORT_EMAIL_TO ?? "annikasu8@gmail.com",
    subject: `Kasuwright E2E Report — ${reqs.length} requirements, ${cases.length} test cases`,
    text: stages.map((s) => `${s.name}: ${s.detail}`).join("\n"),
    html,
  });
  put("report.eml", eml);
  const smtp = smtpConfigFromEnv();
  if (smtp) {
    await sendViaSmtp(smtp, smtp.to, eml);
    push({ name: "9. Email report", detail: `Sent to ${smtp.to} via ${smtp.host}` });
  } else {
    push({ name: "9. Email report", detail: "report.eml written — set SMTP_HOST / SMTP_FROM / REPORT_EMAIL_TO to send automatically" });
  }

  // 10 — CI/CD
  put("Jenkinsfile", jenkinsfile());
  put(".github/workflows/kasuwright.yml", githubActions());
  put("defects.json", JSON.stringify([], null, 2));
  push({ name: "10. CI/CD", detail: "Jenkinsfile + GitHub Actions workflow generated; defects.json will collect auto-defects after test runs" });

  // 11 — Jira publish-back: close the loop on each created Story — an
  // automatic comment plus the run's artefacts attached to the ticket
  // (manual scenarios sheet, test data, automation spec, report).
  if (jiraCfg && createdKeys.length > 0) {
    const published: string[] = [];
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      const storyKey = createdKeys[i * 2]; // issues alternate Story, QA sub-task
      if (!storyKey) continue;
      const reqCases = cases.filter((c) => c.reqId === r.id);
      const ds = dataSets.find((d) => d.reqId === r.id);
      const specRel = join("framework", "tests", `${r.id.toLowerCase()}.spec.ts`);
      const specPath = join(out, specRel);
      const files: JiraPublishFile[] = [
        { name: `manual-scenarios-${r.id.toLowerCase()}.md`, content: testCasesToMarkdown(reqCases) },
        { name: "report.html", content: html },
        { name: "traceability.md", content: traceMd },
      ];
      if (ds) files.push({ name: `test-data-${r.id.toLowerCase()}.csv`, content: dataSetToCsv(ds) });
      if (existsSync(specPath)) files.push({ name: `${r.id.toLowerCase()}.spec.ts`, content: readFileSync(specPath, "utf8") });
      const comment = [
        `Kasuwright run complete for ${r.id} — ${r.title}`,
        `Manual test scenarios: ${reqCases.length} cases (sheet attached)`,
        ds ? `Test data: ${ds.rows.length} rows attached (valid/invalid/empty/boundary)` : "Test data: see attached files",
        `Automation: Playwright spec attached (${r.id.toLowerCase()}.spec.ts)`,
        "Full run report (report.html) and traceability matrix attached.",
        "Status: Generated — pending human review.",
      ].join("\n");
      const res = await publishRunToJira(jiraCfg, storyKey, comment, files);
      published.push(`${storyKey} (${res.attached.length} files${res.commented ? " + comment" : ""}${res.failed.length ? `, failed: ${res.failed.join(", ")}` : ""})`);
    }
    push({ name: "11. Jira publish-back", detail: `Comments + artefacts posted to ${published.length} stories: ${published.join("; ")}` });
  }

  const summary: PipelineSummary = { outDir: out, requirements: reqs.length, jiraIssues: issues.length, testCases: cases.length, stages, jiraCreated: createdKeys };
  put("run-summary.json", JSON.stringify(summary, null, 2));
  return summary;
}
