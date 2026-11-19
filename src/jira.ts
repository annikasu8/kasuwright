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

export interface IssueTypeChoice { story: string; sub: string | null }

/**
 * Pick usable issue-type names from a project's real type list.
 * Company-managed projects use "Story" / "Sub-task"; team-managed projects
 * often have no "Story" (only "Task") and spell the child type "Subtask".
 * Sending a name the project does not have fails with
 * "Specify a valid issue type" — so always resolve against the project.
 */
export function pickIssueTypes(types: { name: string; subtask: boolean }[]): IssueTypeChoice {
  if (types.length === 0) return { story: "Story", sub: "Sub-task" };
  const normal = types.filter((t) => !t.subtask);
  const story =
    normal.find((t) => /^story$/i.test(t.name)) ??
    normal.find((t) => /^task$/i.test(t.name)) ??
    normal[0];
  const sub = types.find((t) => t.subtask);
  return { story: story ? story.name : "Story", sub: sub ? sub.name : null };
}

/** Ask the project which issue types it actually has (createmeta). */
export async function resolveIssueTypes(cfg: JiraConfig, projectKey: string): Promise<IssueTypeChoice> {
  try {
    const res = await fetch(
      `${cfg.baseUrl}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`,
      { headers: { Authorization: authHeader(cfg), Accept: "application/json" } },
    );
    if (!res.ok) return { story: "Story", sub: "Sub-task" };
    const json = (await res.json()) as any;
    const types = (json?.projects?.[0]?.issuetypes ?? []).map((t: any) => ({ name: String(t.name), subtask: Boolean(t.subtask) }));
    return pickIssueTypes(types);
  } catch {
    return { story: "Story", sub: "Sub-task" };
  }
}

export async function pushToJira(issues: JiraIssue[], projectKey: string, cfg: JiraConfig): Promise<string[]> {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  const types = await resolveIssueTypes(cfg, projectKey);
  const created: string[] = [];
  const keyByRef = new Map<string, string>();
  for (const payload of toJiraPayloads(issues, projectKey)) {
    const { kasuwrightRef, parentRef, ...body } = payload as any;
    // Map our logical types onto names this project actually accepts.
    body.fields.issuetype = { name: payload.fields.issuetype.name === "Sub-task" ? (types.sub ?? types.story) : types.story };
    // Real Jira rejects a sub-task with no parent — link it to the Story
    // created just before it (payloads are ordered Story, sub-task, ...).
    if (parentRef && keyByRef.has(parentRef)) {
      body.fields.parent = { key: keyByRef.get(parentRef) };
    }
    const res = await fetch(`${cfg.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jira create failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { key: string };
    created.push(json.key);
    if (kasuwrightRef) keyByRef.set(kasuwrightRef, json.key);
  }
  return created;
}

function authHeader(cfg: JiraConfig): string {
  return `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64")}`;
}

/** Add a plain-text comment (converted to ADF) to an existing issue. */
export async function addJiraComment(cfg: JiraConfig, issueKey: string, text: string): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    headers: { Authorization: authHeader(cfg), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ body: adf(text) }),
  });
  if (!res.ok) throw new Error(`Jira comment failed (${res.status}): ${await res.text()}`);
}

/** Attach one file to an existing issue. */
export async function addJiraAttachment(cfg: JiraConfig, issueKey: string, name: string, content: string | Buffer): Promise<void> {
  const form = new FormData();
  form.append("file", new Blob([content as any]), name);
  const res = await fetch(`${cfg.baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: { Authorization: authHeader(cfg), "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: form,
  });
  if (!res.ok) throw new Error(`Jira attachment ${name} failed (${res.status}): ${await res.text()}`);
}

export interface JiraPublishFile { name: string; content: string | Buffer }
export interface PublishResult { issueKey: string; commented: boolean; attached: string[]; failed: string[] }

/**
 * Close the loop on one issue: post the run comment, then attach the run's
 * artefacts (manual scenarios, test data, automation specs, report).
 * A failed file never fails the publish — it is reported in `failed`.
 */
export async function publishRunToJira(
  cfg: JiraConfig,
  issueKey: string,
  comment: string,
  files: JiraPublishFile[],
): Promise<PublishResult> {
  const result: PublishResult = { issueKey, commented: false, attached: [], failed: [] };
  try {
    await addJiraComment(cfg, issueKey, comment);
    result.commented = true;
  } catch {
    result.failed.push("comment");
  }
  for (const f of files) {
    try {
      await addJiraAttachment(cfg, issueKey, f.name, f.content);
      result.attached.push(f.name);
    } catch {
      result.failed.push(f.name);
    }
  }
  return result;
}
