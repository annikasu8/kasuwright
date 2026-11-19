/**
 * Stage 1 — BRD intake.
 * Parses a Business Requirements Document (Markdown or plain text) into
 * structured requirements the rest of the pipeline can trace.
 *
 * Recognised shapes:
 *  - Explicit IDs:  "REQ-101: User login with MFA" (also FR-, BR-, US-)
 *  - User stories:  "As a cashier, I want to void a sale so that ..."
 *  - "The system shall ..." statements
 *  - Markdown sections (## / ###) — the heading becomes the requirement,
 *    bullets under it become acceptance criteria.
 */
export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  sourceLine: number;
}

const ID_RE = /\b(REQ|FR|BR|US)-?(\d{1,4})\b[:.\s-]*/i;
const STORY_RE = /as an?\s+.+?,\s*i want\s+.+?(?:so that\s+.+)?/i;
const SHALL_RE = /the system shall\s+.+/i;

export function parseBrd(text: string): Requirement[] {
  const lines = text.split(/\r?\n/);
  const reqs: Requirement[] = [];
  let current: Requirement | null = null;
  let seq = 0;

  const push = () => {
    if (current && current.title.trim()) reqs.push(current);
    current = null;
  };
  const start = (title: string, lineNo: number, id?: string): Requirement => {
    push();
    seq += 1;
    current = {
      id: id ?? `REQ-${String(seq).padStart(3, "0")}`,
      title: title.trim().replace(/\*\*/g, ""),
      description: "",
      acceptanceCriteria: [],
      sourceLine: lineNo,
    };
    return current;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const heading = line.match(/^#{2,4}\s+(.*)$/);
    const idMatch = line.match(ID_RE);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if ((bullet || numbered) && current) {
      // Bullets under a requirement are ALWAYS its acceptance criteria —
      // even when they are phrased as "The system shall ..." statements.
      const content = (bullet ?? numbered)![1];
      if (/^acceptance criteria:?$/i.test(content)) return;
      current.acceptanceCriteria.push(content.replace(/\*\*/g, ""));
      return;
    }
    if (heading && !bullet) {
      start(heading[1], i + 1, idMatch ? idMatch[0].replace(/[:.\s-]+$/, "").toUpperCase() : undefined);
      return;
    }
    if (idMatch && (line.length > idMatch[0].length + 3) && !current?.description.includes(line)) {
      const r = start(line.replace(ID_RE, "").replace(/^[:.\s-]+/, ""), i + 1, idMatch[0].replace(/[:.\s-]+$/, "").toUpperCase());
      r.description = line;
      return;
    }
    if (STORY_RE.test(line) || SHALL_RE.test(line)) {
      if (!current || current.description) {
        const r = start(line.slice(0, 90), i + 1);
        r.description = line;
      } else {
        current.description = line;
      }
      return;
    }
    if (current && !current.description) current.description = line;
  });
  push();
  return reqs;
}
