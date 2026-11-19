/**
 * Enterprise layer — the pieces that make the pipeline audit-ready:
 *  - Requirements Traceability Matrix (BRD -> Jira -> cases -> scripts -> result)
 *  - Automatic defect payloads for failing tests (Jira Bugs, evidence attached by CI)
 *  - A single HTML run report
 *  - Email delivery of that report (.eml always; SMTP when configured)
 */
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";
import type { Requirement } from "./brd.js";
import type { JiraIssue } from "./jira.js";
import type { TestCase } from "./testcases.js";

export interface TraceRow {
  reqId: string;
  requirement: string;
  jiraRef: string;
  testCases: string[];
  specFile: string;
  status: "Generated" | "Passed" | "Failed" | "Not run";
}

export function traceability(reqs: Requirement[], issues: JiraIssue[], cases: TestCase[], results?: Map<string, boolean>): TraceRow[] {
  return reqs.map((r) => {
    const story = issues.find((i) => i.key.endsWith(r.id) && i.issueType === "Story");
    const reqCases = cases.filter((c) => c.reqId === r.id);
    const res = results?.get(r.id);
    return {
      reqId: r.id,
      requirement: r.title,
      jiraRef: story?.key ?? "-",
      testCases: reqCases.map((c) => c.id),
      specFile: `tests/${r.id.toLowerCase()}.spec.ts`,
      status: results ? (res ? "Passed" : "Failed") : "Generated",
    };
  });
}

export function traceabilityMarkdown(rows: TraceRow[]): string {
  const lines = [
    "# Requirements Traceability Matrix",
    "",
    "| Req | Requirement | Jira | Test Cases | Automation | Status |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.reqId} | ${r.requirement.replace(/\|/g, "-")} | ${r.jiraRef} | ${r.testCases.join(", ")} | ${r.specFile} | ${r.status} |`),
    "",
    `Coverage: ${rows.length} requirements, ${rows.reduce((n, r) => n + r.testCases.length, 0)} test cases, ${rows.filter((r) => r.testCases.length > 0).length}/${rows.length} requirements with automation.`,
  ];
  return lines.join("\n") + "\n";
}

export function defectsFromFailures(failures: { title: string; error: string }[], projectKey: string) {
  return failures.map((f) => ({
    fields: {
      project: { key: projectKey },
      summary: `[Auto] Test failure: ${f.title}`.slice(0, 240),
      issuetype: { name: "Bug" },
      description: {
        type: "doc", version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: `Raised automatically by Healwright CI. Failing test: ${f.title}. Error: ${f.error}` }] }],
      },
      labels: ["healwright", "auto-defect"],
    },
  }));
}

export function renderHtmlReport(opts: {
  title: string;
  generatedAt: string;
  stages: { name: string; detail: string }[];
  traceRows: TraceRow[];
  extraHtml?: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const stageRows = opts.stages.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.detail)}</td></tr>`).join("\n");
  const traceRows = opts.traceRows.map((r) => `<tr><td>${r.reqId}</td><td>${esc(r.requirement)}</td><td>${r.jiraRef}</td><td>${r.testCases.join(", ")}</td><td>${r.specFile}</td><td>${r.status}</td></tr>`).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}th{background:#111;color:#fff}h1{font-size:1.4rem}</style></head>
<body>
<h1>${esc(opts.title)}</h1>
<p>Generated ${esc(opts.generatedAt)} by Healwright E2E pipeline.</p>
<h2>Pipeline stages</h2>
<table><tr><th>Stage</th><th>Result</th></tr>${stageRows}</table>
<h2>Requirements Traceability Matrix</h2>
<table><tr><th>Req</th><th>Requirement</th><th>Jira</th><th>Test Cases</th><th>Automation</th><th>Status</th></tr>${traceRows}</table>
${opts.extraHtml ?? ""}
</body></html>
`;
}

export function buildEml(opts: { from: string; to: string; subject: string; text: string; html: string }): string {
  const boundary = "healwright-boundary-42";
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    opts.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export interface SmtpConfig { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

/** Minimal SMTP sender (EHLO, optional AUTH LOGIN, MAIL/RCPT/DATA). */
export async function sendViaSmtp(cfg: SmtpConfig, to: string, eml: string): Promise<void> {
  const socket = cfg.secure
    ? tlsConnect(cfg.port, cfg.host, { servername: cfg.host })
    : netConnect(cfg.port, cfg.host);
  await new Promise<void>((res, rej) => { socket.once("connect", res); socket.once("secureConnect", res); socket.once("error", rej); });
  let buffer = "";
  const waitReply = () => new Promise<string>((resolve) => {
    const onData = (d: Buffer) => {
      buffer += d.toString();
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2] ?? "";
      if (/^\d{3} /.test(last)) { socket.off("data", onData); buffer = ""; resolve(last); }
    };
    socket.on("data", onData);
  });
  const send = async (cmd: string) => { socket.write(cmd + "\r\n"); return waitReply(); };
  await waitReply();
  await send(`EHLO healwright`);
  if (cfg.user && cfg.pass) {
    await send("AUTH LOGIN");
    await send(Buffer.from(cfg.user).toString("base64"));
    await send(Buffer.from(cfg.pass).toString("base64"));
  }
  await send(`MAIL FROM:<${cfg.from}>`);
  await send(`RCPT TO:<${to}>`);
  await send("DATA");
  socket.write(eml.replace(/\r?\n/g, "\r\n") + "\r\n.\r\n");
  await waitReply();
  await send("QUIT");
  socket.end();
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): (SmtpConfig & { to: string }) | null {
  if (env.SMTP_HOST && env.SMTP_FROM && env.REPORT_EMAIL_TO) {
    return {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: (env.SMTP_PORT ?? "587") === "465",
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
      to: env.REPORT_EMAIL_TO,
    };
  }
  return null;
}
