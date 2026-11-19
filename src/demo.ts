import { writeFileSync } from "node:fs";
import { findCandidates, type ElementHints } from "./healer.js";

// A login page BEFORE a redesign: the test clicks page.locator('#login-btn')
const pageV1 = `<html><body>
  <form>
    <input id="email" type="email" placeholder="Email" />
    <button id="login-btn" data-testid="login" class="btn primary large">Sign in</button>
    <a href="/reset" class="link">Forgot password?</a>
  </form>
</body></html>`;

// AFTER the redesign: id renamed, data-testid dropped, classes changed.
// A normal test suite now fails with "waiting for locator('#login-btn')".
const pageV2 = `<html><body>
  <form>
    <input id="email" type="email" placeholder="Email" />
    <button id="signin-button" class="cta cta-main">Sign in</button>
    <a href="/reset" class="link">Forgot password?</a>
    <button id="signup-button" class="cta ghost">Create account</button>
  </form>
</body></html>`;

// Hints are what Kasuwright captured from the element while the test still passed (on v1).
const hints: ElementHints = {
  tag: "button",
  text: "Sign in",
  role: "button",
  attributes: { id: "login-btn", "data-testid": "login", class: "btn primary large" },
  originalSelector: "#login-btn",
};

console.log("Simulating: test used page.locator('#login-btn') — that id no longer exists on v2.\n");
const candidates = findCandidates(pageV2, hints);
for (const c of candidates) {
  console.log(`score ${c.score}  <${c.tag}> "${c.text}"`);
  console.log(`  why: ${c.reason.join("; ")}`);
  console.log(`  use instead: ${c.locators[0]}`);
}
const out = {
  originalSelector: hints.originalSelector,
  status: "PENDING_APPROVAL — a human reviews and applies the fix; nothing is edited silently",
  candidates,
};
writeFileSync(new URL("../../examples/heal-suggestions.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nSuggestions saved to examples/heal-suggestions.json for approval.");
void pageV1;
