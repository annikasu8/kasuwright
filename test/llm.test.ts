import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLlmProvider, chatJson } from "../src/llm.js";
import { extractRequirementsLLM, designCasesLLM, analyzeFailureLLM } from "../src/llm-features.js";
import { runPipeline } from "../src/pipeline.js";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("chatJson strips code fences and surrounding prose", async () => {
  const llm = new MockLlmProvider("mock-1", () => "Here you go:\n```json\n{\"a\": 1}\n```\nDone.");
  const out = await chatJson<{ a: number }>(llm, "sys", "usr");
  assert.equal(out?.a, 1);
});

test("extractRequirementsLLM maps model JSON into Requirement objects", async () => {
  const llm = new MockLlmProvider("mock-1", () =>
    JSON.stringify([{ id: "REQ-201", title: "Password reset", description: "Users reset passwords by email link", acceptanceCriteria: ["Reset link expires in 30 minutes"] }]));
  const reqs = await extractRequirementsLLM(" prose brd ", llm);
  assert.equal(reqs?.length, 1);
  assert.equal(reqs?.[0].id, "REQ-201");
  assert.equal(reqs?.[0].acceptanceCriteria[0], "Reset link expires in 30 minutes");
});

test("extractRequirementsLLM returns null on garbage so callers fall back", async () => {
  const llm = new MockLlmProvider("mock-1", () => "no json here");
  assert.equal(await extractRequirementsLLM("x", llm), null);
});

test("designCasesLLM produces compilable semantic steps", async () => {
  const llm = new MockLlmProvider("mock-1", () =>
    JSON.stringify([{ title: "Reset with expired link is rejected", type: "negative", preconditions: ["User exists"], steps: [
      { do: "navigate", target: "/reset?token=expired" },
      { do: "verify", target: "error banner", expected: "Link expired message is shown" },
      { do: "bogus", target: "anything" },
    ] }]));
  const cases = await designCasesLLM({ id: "REQ-201", title: "Password reset", description: "d", acceptanceCriteria: [], sourceLine: 0 }, llm);
  assert.equal(cases?.length, 1);
  assert.equal(cases?.[0].reqId, "REQ-201");
  assert.equal(cases?.[0].steps[1].do, "verify");
  assert.equal(cases?.[0].steps[2].do, "verify"); // unknown verb coerced to verify
});

test("analyzeFailureLLM returns a structured analysis", async () => {
  const llm = new MockLlmProvider("mock-1", () =>
    JSON.stringify({ rootCause: "Locator #login-btn no longer exists after the redesign", evidence: ["Timeout waiting for locator('#login-btn')"], suggestedFix: "Use #signin-button", confidence: "high" }));
  const a = await analyzeFailureLLM({ testTitle: "login", error: "Timeout waiting for locator('#login-btn')" }, llm);
  assert.equal(a?.confidence, "high");
  assert.match(a?.suggestedFix ?? "", /signin-button/);
});

test("pipeline uses the LLM for case design and falls back cleanly on garbage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-llm-"));
  const brd = join(dir, "brd.md");
  writeFileSync(brd, "# BRD\n\n## REQ-101: User login\nThe system shall allow users to log in with email and password.\n- Valid credentials show the dashboard\n");
  const good = new MockLlmProvider("mock-1", (msgs) => {
    if (msgs[0].content.includes("extract software requirements")) return JSON.stringify([]); // extraction: nothing extra
    return JSON.stringify([{ title: "Login happy path", type: "positive", preconditions: [], steps: [{ do: "navigate", target: "/login" }, { do: "verify", target: "dashboard", expected: "Dashboard is shown" }] }]);
  });
  const s1 = await runPipeline({ brdPath: brd, outDir: join(dir, "run1"), projectKey: "QA", llm: good });
  const cases = JSON.parse(readFileSync(join(dir, "run1", "test-cases.json"), "utf8"));
  assert.ok(cases.some((c: any) => c.id.includes("-L1")), "LLM-designed case present");
  assert.ok(s1.testCases >= 1);

  const bad = new MockLlmProvider("mock-1", () => "total garbage");
  const s2 = await runPipeline({ brdPath: brd, outDir: join(dir, "run2"), projectKey: "QA", llm: bad });
  assert.equal(s2.testCases, 3, "template fallback yields the standard 3 cases");
});
