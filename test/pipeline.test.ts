import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrd } from "../src/brd.js";
import { toJiraIssues } from "../src/jira.js";
import { generateTestCases } from "../src/testcases.js";
import { generateDataSet } from "../src/testdata.js";
import { traceability } from "../src/enterprise.js";

const BRD = `## REQ-101: User login with email and password
As a customer, I want to log in so that I can access my account.
- Given valid credentials, then the dashboard is shown
- The system shall validate the email format
`;

test("BRD parser extracts the requirement and its criteria", () => {
  const reqs = parseBrd(BRD);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].id, "REQ-101");
  assert.ok(reqs[0].acceptanceCriteria.length >= 2);
});

test("full chain: req -> jira -> cases -> data -> traceability", () => {
  const reqs = parseBrd(BRD);
  const issues = toJiraIssues(reqs, "QA");
  assert.equal(issues.filter((i) => i.issueType === "Story").length, 1);
  const cases = generateTestCases(reqs);
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.type), ["positive", "negative", "boundary"]);
  const ds = generateDataSet(reqs[0]);
  assert.equal(ds.rows.length, 5);
  assert.ok(ds.rows.find((r) => r.case === "valid")!.values.email?.includes("@example.com"));
  const rows = traceability(reqs, issues, cases);
  assert.equal(rows[0].testCases.length, 3);
  assert.equal(rows[0].specFile, "tests/req-101.spec.ts");
});
