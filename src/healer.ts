import { parseHTML } from "linkedom";

/** What we remember about the element a test originally pointed at. */
export interface ElementHints {
  tag?: string;
  text?: string;
  role?: string;
  attributes?: Record<string, string>;
  originalSelector?: string;
}

export interface HealCandidate {
  score: number;
  tag: string;
  text: string;
  locators: string[];
  reason: string[];
}

const ROLE_BY_TAG: Record<string, string> = {
  button: "button",
  a: "link",
  input: "textbox",
  select: "combobox",
  textarea: "textbox",
  img: "img",
};

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function locatorsFor(el: any): string[] {
  const out: string[] = [];
  const testId = el.getAttribute?.("data-testid");
  if (testId) out.push(`page.getByTestId('${testId}')`);
  const id = el.getAttribute?.("id");
  if (id) out.push(`page.locator('#${id}')`);
  const tag = (el.tagName ?? "").toLowerCase();
  const role = el.getAttribute?.("role") || ROLE_BY_TAG[tag];
  const text = norm(el.textContent).slice(0, 60);
  const aria = el.getAttribute?.("aria-label");
  if (role && (aria || text)) {
    out.push(`page.getByRole('${role}', { name: '${aria || text}' })`);
  }
  if (aria) out.push(`page.getByLabel('${aria}')`);
  if (text && text.length <= 40 && !role) out.push(`page.getByText('${text}')`);
  const cls = (el.getAttribute?.("class") || "").split(/\s+/).filter(Boolean);
  out.push(`page.locator('${tag}${cls.length ? "." + cls.join(".") : ""}')`);
  return out;
}

function scoreElement(el: any, hints: ElementHints): { score: number; reason: string[] } {
  let score = 0;
  const reason: string[] = [];
  const attrs = hints.attributes ?? {};
  const tag = (el.tagName ?? "").toLowerCase();

  if (hints.tag && tag === hints.tag.toLowerCase()) {
    score += 10;
    reason.push(`tag <${tag}> matches`);
  }
  const elTestId = el.getAttribute?.("data-testid");
  if (attrs["data-testid"] && elTestId === attrs["data-testid"]) {
    score += 100;
    reason.push("data-testid unchanged");
  }
  const elId = el.getAttribute?.("id");
  if (attrs.id && elId) {
    if (elId === attrs.id) {
      score += 90;
      reason.push("id unchanged");
    } else if (
      elId.replace(/[-_]/g, "").includes(String(attrs.id).replace(/[-_]/g, "").slice(0, 5)) ||
      String(attrs.id).replace(/[-_]/g, "").includes(elId.replace(/[-_]/g, "").slice(0, 5))
    ) {
      score += 25;
      reason.push(`id is similar ('${attrs.id}' -> '${elId}')`);
    }
  }
  const elText = norm(el.textContent);
  const hintText = norm(hints.text);
  if (hintText && elText) {
    if (elText === hintText) {
      score += 60;
      reason.push(`visible text unchanged ('${hints.text}')`);
    } else if (elText.includes(hintText) || hintText.includes(elText)) {
      score += 30;
      reason.push("visible text partially matches");
    }
  }
  const elAria = el.getAttribute?.("aria-label");
  if (attrs["aria-label"] && elAria === attrs["aria-label"]) {
    score += 40;
    reason.push("aria-label unchanged");
  }
  const elRole = el.getAttribute?.("role") || ROLE_BY_TAG[tag];
  if (hints.role && elRole === hints.role) {
    score += 30;
    reason.push(`role '${hints.role}' matches`);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (["data-testid", "id", "aria-label", "class"].includes(k)) continue;
    if (el.getAttribute?.(k) === v) {
      score += 20;
      reason.push(`attribute ${k} unchanged`);
    }
  }
  const hintClasses = (attrs.class ?? "").split(/\s+/).filter(Boolean);
  const elClasses = (el.getAttribute?.("class") || "").split(/\s+/).filter(Boolean);
  const shared = hintClasses.filter((c) => elClasses.includes(c));
  if (shared.length) {
    score += shared.length * 5;
    reason.push(`shared classes: ${shared.join(", ")}`);
  }
  return { score, reason };
}

/**
 * Find the most likely element(s) a broken locator was pointing at,
 * by scoring every element in the page against the captured hints.
 */
export function findCandidates(html: string, hints: ElementHints, topN = 3): HealCandidate[] {
  const { document } = parseHTML(html);
  const results: HealCandidate[] = [];
  for (const el of Array.from(document.querySelectorAll("*")) as any[]) {
    const { score, reason } = scoreElement(el, hints);
    if (score <= 0) continue;
    results.push({
      score,
      tag: (el.tagName ?? "").toLowerCase(),
      text: norm(el.textContent).slice(0, 60),
      locators: locatorsFor(el),
      reason,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}
