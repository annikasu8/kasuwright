import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvidenceWorkbook } from "../src/evidence.js";
import { executeCases, type CaseExecution } from "../src/execute.js";
import type { TestCase } from "../src/testcases.js";

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("evidence workbook embeds step screenshots and a summary sheet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-ev-"));
  const shot = join(dir, "step.png");
  writeFileSync(shot, PNG_1PX);
  const executions: CaseExecution[] = [
    {
      caseId: "TC-REQ-1-01",
      reqId: "REQ-1",
      title: "Valid login",
      status: "partial",
      steps: [
        { n: 1, action: "navigate", target: "/login", detail: "Opened https://app.example.com/login", status: "pass", screenshot: shot },
        { n: 2, action: "enter", target: "Email", detail: 'Entered "Email" via label = qa.user@example.com', status: "pass", screenshot: shot },
        { n: 3, action: "verify", target: "dashboard", detail: "Could not auto-verify — screenshot attached", expected: "User lands on the dashboard", status: "check", screenshot: shot },
      ],
    },
  ];
  const out = join(dir, "evidence.xlsx");
  await buildEvidenceWorkbook(executions, out, "Test evidence");
  assert.ok(existsSync(out));
  assert.ok(statSync(out).size > 3000, `workbook too small: ${statSync(out).size}`);

  const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  assert.ok(wb.getWorksheet("Summary"), "summary sheet exists");
  const sheet = wb.getWorksheet("TC-REQ-1-01");
  assert.ok(sheet, "case sheet exists");
  // Row 3 = first step row (title, header, then steps)
  assert.equal(sheet.getRow(3).getCell(2).value, "navigate");
  assert.equal(sheet.getRow(3).getCell(5).value, "PASS");
  assert.equal(sheet.getRow(5).getCell(5).value, "CHECK");
});

test("executor records API/DB-only cases without launching a browser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-exec-"));
  const cases: TestCase[] = [
    {
      id: "TC-REQ-9-01",
      reqId: "REQ-9",
      title: "API login",
      type: "positive",
      priority: "High",
      preconditions: [],
      steps: [{ do: "call", target: "POST /login" }],
    },
  ];
  const executions = await executeCases(cases, { baseUrl: "https://example.com", data: {}, outDir: dir });
  assert.ok(executions, "executions returned");
  assert.equal(executions[0].steps[0].status, "skip");
  assert.equal(executions[0].status, "partial");
});
