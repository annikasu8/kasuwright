import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrdCandidates, pickCandidate } from "../src/wizard.js";

test("findBrdCandidates ranks BRD-named docs first and skips README", () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-wiz-"));
  writeFileSync(join(dir, "README.md"), "x");
  writeFileSync(join(dir, "notes.md"), "x");
  writeFileSync(join(dir, "BRD-checkout.md"), "x");
  writeFileSync(join(dir, "image.png"), "x");
  const found = findBrdCandidates(dir);
  assert.equal(found.length, 2);
  assert.match(found[0], /BRD-checkout\.md$/);
  assert.match(found[1], /notes\.md$/);
});

test("pickCandidate: Enter picks first, numbers pick by index, paths pass through", () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-wiz-"));
  const a = join(dir, "a.md"); const b = join(dir, "b.md");
  writeFileSync(a, "x"); writeFileSync(b, "x");
  assert.equal(pickCandidate("", [a, b]), a);
  assert.equal(pickCandidate("2", [a, b]), b);
  assert.equal(pickCandidate("9", [a, b]), null);
  assert.equal(pickCandidate(a, []), a);
  assert.equal(pickCandidate("/no/such/file.md", []), null);
});
