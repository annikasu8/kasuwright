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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBrd } from "./brd.js";
import { toJiraIssues, toJiraPayloads, toJiraCsv, jiraConfigFromEnv, pushToJira } from "./jira.js";
import { generateTestCases, testCasesToMarkdown } from "./testcases.js";
import { generateDataSet, dataSetToCsv, dataSetToSql } from "./testdata.js";
import { scaffoldFramework } from "./codegen.js";
import { traceability, traceabilityMarkdown, renderHtmlReport, buildEml, smtpConfigFromEnv, sendViaSmtp } from "./enterprise.js";
import { jenkinsfile, githubActions } from "./ci.js";

export interface PipelineOptions { brdPath: string; outDir: string; projectKey?: string }
export interface StageResult { name: string; detail: string }
export interface PipelineSummary { outDir: string; requirements: number; jiraIssues: number; testCases: number; stages: StageResult[] }

export async function runPipeline(opts: PipelineOptions): Promise<PipelineSummary> {
  const projectKey = opts.projectKey ?? "QA";
  const out = opts.outDir;
  mkdirSync(out, { recursive: true });
  const stages: StageResult[] = [];
  const put = (rel: string, content: string) => {
    const p = join(out, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };

  // 1 — BRD intake
  const reqs = parseBrd(readFileSync(opts.brdPath, "utf8"));
  put("requirements.json", JSON.stringify(reqs, null, 2));
  stages.push({ name: "1. BRD intake", detail: `${reqs.length} requirements parsed (${reqs.map((r) => r.id).join(", ")})` });

  // 2 — Jira
  const issues = toJiraIssues(reqs, projectKey);
  put("jira/jira-payloads.json", JSON.stringify(toJiraPayloads(issues, projectKey), null, 2));
  put("jira/jira-import.csv", toJiraCsv(issues));
  const jiraCfg = jiraConfigFromEnv();
  if (jiraCfg) {
    const keys = await pushToJira(issues, projectKey, jiraCfg);
    stages.push({ name: "2. Jira", detail: `Created ${keys.length} issues in ${projectKey}: ${keys.join(", ")}` });
  } else {
    stages.push({ name: "2. Jira", detail: `${issues.length} issues exported (jira-payloads.json + jira-import.csv) — set JIRA_* env to create them directly` });
  }

  // 3 — Manual test cases
  const cases = generateTestCases(reqs);
  put("test-cases.json", JSON.stringify(cases, null, 2));
  put("test-cases.md", testCasesToMarkdown(cases));
  stages.push({ name: "3. Manual test cases", detail: `${cases.length} cases generated (positive / negative / boundary per requirement) — pending human review` });

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
  stages.push({ name: "4. Test data", detail: `${dataSets.length} synthetic data sets (valid/invalid/empty/boundary) as JSON + CSV + SQL` });

  // 5–7 — Framework scaffold + automation compilation (UI/API/DB flows)
  const byReqCases = new Map<string, { title: string; cases: typeof cases }>();
  for (const r of reqs) byReqCases.set(r.id, { title: r.title, cases: cases.filter((c) => c.reqId === r.id) });
  const scaffold = scaffoldFramework(join(out, "framework"), byReqCases, namedSets, sql);
  stages.push({ name: "5-7. Framework + automation", detail: `Playwright framework scaffolded (${scaffold.files.length} files): specs per requirement, test data, DB validations` });

  // 8 — Traceability + report
  const traceRows = traceability(reqs, issues, cases);
  put("traceability.md", traceabilityMarkdown(traceRows));
  const html = renderHtmlReport({
    title: `Kasuwright E2E Run — ${projectKey}`,
    generatedAt: new Date().toISOString(),
    stages,
    traceRows,
  });
  put("report.html", html);
  stages.push({ name: "8. Traceability + report", detail: `Matrix covers ${traceRows.length} requirements; report.html generated` });

  // 9 — Email
  const eml = buildEml({
    from: process.env.SMTP_FROM ?? "kasuwright@localhost",
    to: process.env.REPORT_EMAIL_TO ?? "qa-team@company.com",
    subject: `Kasuwright E2E Report — ${reqs.length} requirements, ${cases.length} test cases`,
    text: stages.map((s) => `${s.name}: ${s.detail}`).join("\n"),
    html,
  });
  put("report.eml", eml);
  const smtp = smtpConfigFromEnv();
  if (smtp) {
    await sendViaSmtp(smtp, smtp.to, eml);
    stages.push({ name: "9. Email report", detail: `Sent to ${smtp.to} via ${smtp.host}` });
  } else {
    stages.push({ name: "9. Email report", detail: "report.eml written — set SMTP_HOST / SMTP_FROM / REPORT_EMAIL_TO to send automatically" });
  }

  // 10 — CI/CD
  put("Jenkinsfile", jenkinsfile());
  put(".github/workflows/kasuwright.yml", githubActions());
  put("defects.json", JSON.stringify([], null, 2));
  stages.push({ name: "10. CI/CD", detail: "Jenkinsfile + GitHub Actions workflow generated; defects.json will collect auto-defects after test runs" });

  const summary: PipelineSummary = { outDir: out, requirements: reqs.length, jiraIssues: issues.length, testCases: cases.length, stages };
  put("run-summary.json", JSON.stringify(summary, null, 2));
  return summary;
}
