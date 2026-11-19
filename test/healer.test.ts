import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidates } from "../src/healer.js";
import { summarize, diagnose } from "../src/analyze.js";

const v2 = `<html><body><form>
  <button id="signin-button" class="cta cta-main">Sign in</button>
  <button id="signup-button" class="cta ghost">Create account</button>
</form></body></html>`;

test("healer finds the renamed Sign in button first", () => {
  const [top] = findCandidates(v2, {
    tag: "button",
    text: "Sign in",
    role: "button",
    attributes: { id: "login-btn", "data-testid": "login", class: "btn primary" },
  });
  assert.ok(top);
  assert.equal(top.text, "sign in");
  assert.ok(top.score >= 100, `expected strong score, got ${top.score}`);
  assert.match(top.locators.join(" "), /signin-button/);
});

test("unchanged data-testid is a perfect match", () => {
  const html = `<div><span data-testid="login">Sign in</span></div>`;
  const [top] = findCandidates(html, { attributes: { "data-testid": "login" } });
  assert.ok(top.score >= 100);
});

test("summarize flags a test that both passed and failed as flaky", () => {
  const stats = summarize([
    { ts: "1", file: "a.spec.ts", title: "login", status: "passed", durationMs: 10 },
    { ts: "2", file: "a.spec.ts", title: "login", status: "failed", durationMs: 10, error: "locator: waiting for #x" },
  ]);
  assert.equal(stats[0].flaky, true);
  assert.match(diagnose("locator: waiting for #x"), /Locator problem/);
});
