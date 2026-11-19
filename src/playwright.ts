import type { Page } from "@playwright/test";
import { findCandidates, type ElementHints, type HealCandidate } from "./healer.js";

/** Capture hints for the element a working selector points at (run while the test still passes). */
export async function captureHints(page: Page, selector: string): Promise<ElementHints> {
  const handle = await page.waitForSelector(selector, { state: "attached" });
  if (!handle) throw new Error(`captureHints: nothing matches ${selector}`);
  return handle.evaluate((el: Element) => {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      role: el.getAttribute("role") ?? undefined,
      attributes: attrs,
      originalSelector: undefined,
    };
  }).then((h: ElementHints) => ({ ...h, originalSelector: selector }));
}

/** After a UI change breaks the selector, find the element it most likely meant. */
export async function healLocator(page: Page, hints: ElementHints): Promise<HealCandidate[]> {
  const html = await page.content();
  return findCandidates(html, hints);
}
