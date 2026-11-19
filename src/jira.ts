/**
 * Stage 2 — Jira.
 * Turns requirements into Jira-ready work: one Story per requirement plus a
 * QA sub-task, exported as (a) REST API v3 payloads and (b) a bulk-import CSV.
 * With JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN set, `pushToJira` creates
 * them for real; without credentials it stays in export mode — nothing is
 * ever sent anywhere silently.
 */
import type { Requirement } from "./brd.js";

export interface JiraIssue {
  key: string; // local reference key until Jira assigns a real one
  summary: string;
  issueType: "Story" | "Sub-task";
  parentRef?: string;
  description: string;
  labels: string[];
}

export function toJiraIssues(reqs: Requirement[], projectKey: string): JiraIssue[] {
  const issues: JiraIssue[] = [];
  for (const r of reqs) {
    const ref = `${projectKey}-${r.id}`;
    issues.push({
      key: ref,
      summary: r.title,
      issueType: "Story",
      description: [
        `Source: BRD requirement ${r.id} (line ${r.sourceLine})`,
        "",
        r.description || r.title,
        "",
        "Acceptance Criteria:",
        ...r.acceptanceCriteria.map((c) => `- ${c}`),
      ].join("\n"),
      labels: ["kasuwright", "from-brd", r.id.toLowerCase()],
    });
    issues.push({
      key: `${ref}-QA`,
      summary: `QA: Test cases & automation for ${r.id} — ${r.title}`.slice(0, 240),
      issueType: "Sub-task",
      parentRef: ref,
      description: `Design manual test cases, test data, and Playwright automation for ${r.id}. Generated and tracked by Kasuwright.`,
      labels: ["kasuwright", "qa", r.id.toLowerCase()],
    });
  }
  return issues;
}

function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

export function toJiraPayloads(issues: JiraIssue[], projectKey: string) {
  return issues.map((i) => ({
    fields: {
      project: { key: projectKey },
      summary: i.summary,
      issuetype: { name: i.issueType },
      description: adf(i.description),
      labels: i.labels,
    },
    kasuwrightRef: i.key,
    parentRef: i.parentRef ?? null,
  }));
}

export function toJiraCsv(issues: JiraIssue[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const rows = [["Summary", "Issue Type", "Description", "Labels", "Kasuwright Ref", "Parent Ref"].join(",")];
  for (const i of issues) rows.push([esc(i.summary), i.issueType, esc(i.description), i.labels.join(" "), i.key, i.parentRef ?? ""].join(","));
  return rows.join("\n") + "\n";
}

export interface JiraConfig { baseUrl: string; email: string; apiToken: string }

export function jiraConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JiraConfig | null {
  if (env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    return { baseUrl: env.JIRA_BASE_URL.replace(/\/$/, ""), email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN };
  }
  return null;
}

export async function pushToJira(issues: JiraIssue[], projectKey: string, cfg: JiraConfig): Promise<string[]> {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const created: string[] = [];
  for (const payload of toJiraPayloads(issues, projectKey)) {
    const { kasuwrightRef, parentRef, ...body } = payload as any;
    void kasuwrightRef; void parentRef; // sub-task parenting resolved by caller once real keys exist
    const res = await fetch(`${cfg.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jira create failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { key: string };
    created.push(json.key);
  }
  return created;
}
