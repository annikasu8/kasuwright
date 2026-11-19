/**
 * Stage 4 — Test data creation.
 * Infers the data fields a requirement talks about and generates synthetic,
 * PII-safe data sets: valid, invalid, empty and boundary rows, exported as
 * JSON, CSV and SQL INSERTs. All values are fake by construction
 * (example.com mailboxes, 555 phone numbers, test card numbers).
 */
import type { Requirement } from "./brd.js";

export type FieldKind = "email" | "password" | "phone" | "name" | "amount" | "date" | "quantity" | "username" | "cardNumber" | "text";

export interface DataRow { case: "valid" | "invalid" | "empty" | "boundary-min" | "boundary-max"; values: Record<string, string> }

const FIELD_PATTERNS: { kind: FieldKind; re: RegExp; label: string }[] = [
  { kind: "email", re: /e-?mail/i, label: "email" },
  { kind: "password", re: /password|passwd/i, label: "password" },
  { kind: "cardNumber", re: /card number|credit card/i, label: "cardNumber" },
  { kind: "phone", re: /phone|mobile/i, label: "phone" },
  { kind: "amount", re: /amount|price|payment|total|cost/i, label: "amount" },
  { kind: "date", re: /date|dob|expiry/i, label: "date" },
  { kind: "quantity", re: /quantity|qty|count/i, label: "quantity" },
  { kind: "username", re: /user ?name|user id/i, label: "username" },
  { kind: "name", re: /\bname\b/i, label: "name" },
];

const SAMPLES: Record<FieldKind, Record<DataRow["case"], string>> = {
  email: { valid: "qa.user@example.com", invalid: "not-an-email", empty: "", "boundary-min": "a@b.co", "boundary-max": `${"a".repeat(64)}@example.com` },
  password: { valid: "Str0ng!Pass1", invalid: "123", empty: "", "boundary-min": "Aa1!aaaa", "boundary-max": "Aa1!".repeat(16) },
  phone: { valid: "+1-555-010-2233", invalid: "12345", empty: "", "boundary-min": "5550100", "boundary-max": "+1-555-010-2233-9999" },
  name: { valid: "Asha Verma", invalid: "12345 !!!", empty: "", "boundary-min": "A", "boundary-max": "A".repeat(100) },
  amount: { valid: "49.99", invalid: "-5", empty: "", "boundary-min": "0.01", "boundary-max": "999999.99" },
  date: { valid: "2026-12-31", invalid: "31-13-2026", empty: "", "boundary-min": "1900-01-01", "boundary-max": "2099-12-31" },
  quantity: { valid: "2", invalid: "-1", empty: "", "boundary-min": "0", "boundary-max": "100000" },
  username: { valid: "qa_user_01", invalid: "qa user!", empty: "", "boundary-min": "ab", "boundary-max": "u".repeat(50) },
  cardNumber: { valid: "4242424242424242", invalid: "1234567890123456", empty: "", "boundary-min": "424242424242", "boundary-max": "42424242424242424242" },
  text: { valid: "Sample text", invalid: "<script>alert(1)</script>", empty: "", "boundary-min": "x", "boundary-max": "x".repeat(500) },
};

export function inferFields(r: Requirement): { label: string; kind: FieldKind }[] {
  const hay = `${r.title} ${r.description} ${r.acceptanceCriteria.join(" ")}`;
  const found = new Map<string, FieldKind>();
  for (const p of FIELD_PATTERNS) if (p.re.test(hay)) found.set(p.label, p.kind);
  if (!found.size) found.set("text", "text");
  return [...found.entries()].map(([label, kind]) => ({ label, kind }));
}

export function generateDataSet(r: Requirement): { reqId: string; rows: DataRow[] } {
  const fields = inferFields(r);
  const cases: DataRow["case"][] = ["valid", "invalid", "empty", "boundary-min", "boundary-max"];
  const rows = cases.map((c) => ({
    case: c,
    values: Object.fromEntries(fields.map((f) => [f.label, SAMPLES[f.kind][c]])),
  }));
  return { reqId: r.id, rows };
}

export function dataSetToCsv(ds: { reqId: string; rows: DataRow[] }): string {
  const fields = Object.keys(ds.rows[0]?.values ?? {});
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [["reqId", "case", ...fields].join(","), ...ds.rows.map((r) => [ds.reqId, r.case, ...fields.map((f) => esc(r.values[f] ?? ""))].join(","))].join("\n") + "\n";
}

export function dataSetToSql(ds: { reqId: string; rows: DataRow[] }): string {
  const fields = Object.keys(ds.rows[0]?.values ?? {});
  const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return ds.rows
    .map((r) => `INSERT INTO test_data (req_id, case_name, ${fields.join(", ")}) VALUES (${esc(ds.reqId)}, ${esc(r.case)}, ${fields.map((f) => esc(r.values[f] ?? "")).join(", ")});`)
    .join("\n") + "\n";
}
