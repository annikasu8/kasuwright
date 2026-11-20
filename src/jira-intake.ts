import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBrd, type Requirement } from "./brd.js";
import type { JiraConfig } from "./jira.js";

function authHeader(cfg: JiraConfig): string {
  return `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64")}`;
}

/** Render an Atlassian Document Format (ADF) node tree as plain text. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  const children = Array.isArray(n.content) ? n.content.map(adfToText) : [];
  switch (n.type) {
    case "doc":
      return children.join("\n");
    case "text":
      return n.text ?? "";
    case "paragraph":
    case "heading":
    case "blockquote":
    case "listItem":
      return children.join("") + "\n";
    case "bulletList":
    case "orderedList":
      return children.map((c) => c.trim()).filter(Boolean).map((c) => `- ${c}`).join("\n") + "\n";
    case "codeBlock":
      return children.join("") + "\n";
    case "hardBreak":
      return "\n";
    case "rule":
      return "\n---\n";
    default:
      return children.join("");
  }
}

/**
 * Pull acceptance criteria out of free text: the lines under an
 * "Acceptance Criteria" heading first; otherwise every bullet line.
 */
export function extractAcceptanceCriteria(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const bullet = (l: string) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
  const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l);
  const start = lines.findIndex((l) => /acceptance\s+criteria/i.test(l));
  if (start >= 0) {
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { if (out.length) break; continue; }
      if (isBullet(l)) { out.push(bullet(l)); continue; }
      if (/^[A-Z][A-Za-z ]{2,40}:\s*$/.test(l.trim()) && out.length) break; // next section heading
      if (out.length) break;
    }
    if (out.length) return out;
  }
  return lines.filter(isBullet).map(bullet).filter((l) => l.length > 2);
}

export interface JiraAttachment { id: string; filename: string; mimeType: string; contentUrl: string }
export interface FetchedIssue {
  key: string;
  summary: string;
  descriptionText: string;
  acceptanceCriteria: string[];
  attachments: JiraAttachment[];
  isSubtask: boolean;
}

export async function fetchJiraIssue(cfg: JiraConfig, key: string): Promise<FetchedIssue> {
  const res = await fetch(
    `${cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,attachment,issuetype`,
    { headers: { Authorization: authHeader(cfg), Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Jira fetch of ${key} failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as any;
  const f = json.fields ?? {};
  const descriptionText = typeof f.description === "string" ? f.description : adfToText(f.description).trim();
  return {
    key: json.key ?? key,
    summary: String(f.summary ?? key),
    descriptionText,
    acceptanceCriteria: extractAcceptanceCriteria(descriptionText),
    attachments: (f.attachment ?? []).map((a: any) => ({
      id: String(a.id), filename: String(a.filename), mimeType: String(a.mimeType ?? ""), contentUrl: String(a.content),
    })),
    isSubtask: Boolean(f.issuetype?.subtask),
  };
}

export async function downloadAttachment(cfg: JiraConfig, att: JiraAttachment): Promise<Buffer> {
  const res = await fetch(att.contentUrl, { headers: { Authorization: authHeader(cfg) } });
  if (!res.ok) throw new Error(`Attachment ${att.filename} download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export interface TicketIntake {
  requirements: Requirement[];
  providedData: string[];
  attachmentNames: string[];
  ticketText: string;
}

/**
 * Turn an existing Jira ticket into pipeline requirements: the ticket itself
 * is the primary requirement (its acceptance criteria drive the cases); any
 * attached BRD document adds requirements; CSV/JSON attachments are kept as
 * the team's provided mock data.
 */
export async function intakeFromTicket(cfg: JiraConfig, key: string, outDir: string): Promise<TicketIntake> {
  const issue = await fetchJiraIssue(cfg, key);
  const primary: Requirement = {
    id: issue.key,
    title: issue.summary,
    description: issue.descriptionText,
    acceptanceCriteria: issue.acceptanceCriteria,
    sourceLine: 0,
  };
  const requirements: Requirement[] = [primary];
  const providedData: string[] = [];
  const attachmentNames: string[] = [];
  const attDir = join(outDir, "ticket-attachments");
  for (const att of issue.attachments) {
    attachmentNames.push(att.filename);
    try {
      const buf = await downloadAttachment(cfg, att);
      mkdirSync(attDir, { recursive: true });
      writeFileSync(join(attDir, att.filename), buf);
      const lower = att.filename.toLowerCase();
      if (lower.endsWith(".md") || lower.endsWith(".txt")) {
        const extra = parseBrd(buf.toString("utf8")).filter((r) => r.id !== primary.id);
        for (const r of extra) if (!requirements.some((x) => x.id === r.id)) requirements.push(r);
      } else if (lower.endsWith(".csv") || lower.endsWith(".json")) {
        providedData.push(att.filename);
      }
    } catch {
      // A failed attachment never blocks the run; it is still listed by name.
    }
  }
  const ticketText = [
    `# ${issue.key}: ${issue.summary}`,
    "",
    issue.descriptionText,
    "",
    "## Acceptance Criteria",
    ...issue.acceptanceCriteria.map((c) => `- ${c}`),
  ].join("\n");
  return { requirements, providedData, attachmentNames, ticketText };
}
