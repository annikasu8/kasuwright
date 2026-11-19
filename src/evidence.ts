/**
 * v0.7 — Excel evidence workbook.
 * One Summary sheet + one sheet per executed test case: every step with
 * its description, status and the screenshot captured at that step,
 * embedded in the sheet — the proof pack manual testers asked for.
 */
import { existsSync, readFileSync } from "node:fs";
import type { CaseExecution } from "./execute.js";

const STATUS_FILL: Record<string, string> = {
  pass: "C6EFCE",
  fail: "FFC7CE",
  check: "FFEB9C",
  skip: "D9D9D9",
  partial: "FFEB9C",
};

function sheetName(caseId: string): string {
  return caseId.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
}

export async function buildEvidenceWorkbook(executions: CaseExecution[], outPath: string, title: string): Promise<void> {
  const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kasuwright";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Test Case", key: "id", width: 18 },
    { header: "Title", key: "title", width: 52 },
    { header: "Status", key: "status", width: 12 },
    { header: "Steps", key: "steps", width: 8 },
    { header: "Passed", key: "passed", width: 8 },
    { header: "Failed", key: "failed", width: 8 },
    { header: "Check / Skip", key: "other", width: 12 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const ex of executions) {
    const row = summary.addRow({
      id: ex.caseId,
      title: ex.title,
      status: ex.status.toUpperCase(),
      steps: ex.steps.length,
      passed: ex.steps.filter((s) => s.status === "pass").length,
      failed: ex.steps.filter((s) => s.status === "fail").length,
      other: ex.steps.filter((s) => s.status === "check" || s.status === "skip").length,
    });
    const cell = row.getCell("status");
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (STATUS_FILL[ex.status] ?? "FFFFFF") } };
  }
  summary.insertRow(1, [title]);
  summary.getRow(1).font = { bold: true, size: 13 };

  for (const ex of executions) {
    const ws = wb.addWorksheet(sheetName(ex.caseId));
    ws.columns = [
      { width: 7 },   // Step
      { width: 13 },  // Action
      { width: 24 },  // Target
      { width: 62 },  // Description / result
      { width: 12 },  // Status
      { width: 46 },  // Screenshot
    ];
    const titleRow = ws.addRow([`${ex.caseId} — ${ex.title}  (${ex.status.toUpperCase()})`]);
    titleRow.font = { bold: true, size: 12 };
    const head = ws.addRow(["Step", "Action", "Target", "Description / Result", "Status", "Screenshot"]);
    head.font = { bold: true };
    for (const st of ex.steps) {
      const row = ws.addRow([st.n, st.action, st.target, st.expected ? `${st.detail}\nExpected: ${st.expected}` : st.detail, st.status.toUpperCase(), ""]);
      row.getCell(4).alignment = { wrapText: true, vertical: "top" };
      row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (STATUS_FILL[st.status] ?? "FFFFFF") } };
      if (st.screenshot && existsSync(st.screenshot)) {
        row.height = 128;
        const img = wb.addImage({ buffer: readFileSync(st.screenshot) as any, extension: "png" });
        ws.addImage(img, { tl: { col: 5, row: row.number - 1 }, ext: { width: 300, height: 122 } });
      } else {
        row.height = 30;
      }
    }
  }

  await wb.xlsx.writeFile(outPath);
}
