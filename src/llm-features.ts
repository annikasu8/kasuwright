/**
 * LLM-powered features (v0.3). Each function returns null when the model
 * output is missing or malformed, so callers fall back to the deterministic
 * engines — the pipeline never breaks because an LLM call failed.
 *
 * LLM-designed test cases use the same semantic step vocabulary
 * (navigate / enter / click / verify / call / query) as the template engine,
 * so Stage 7 compiles them into Playwright code exactly the same way.
 */
import { chatJson, type LlmProvider } from "./llm.js";
import type { Requirement } from "./brd.js";
import type { TestCase, TestStep } from "./testcases.js";

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : [];

const VERBS: TestStep["do"][] = ["navigate", "enter", "click", "verify", "call", "query"];
function toStep(v: any): TestStep | null {
  if (!v || !isStr(v.target)) return null;
  const verb = VERBS.includes(v.do) ? v.do : "verify";
  const step: TestStep = { do: verb, target: v.target.trim() };
  if (isStr(v.value)) step.value = v.value.trim();
  if (isStr(v.expected)) step.expected = v.expected.trim();
  return step;
}

/**
 * Extract requirements from an unstructured BRD — documents with no REQ-IDs,
 * written as prose. The deterministic parser handles structured documents;
 * this handles the messy real-world ones.
 */
export async function extractRequirementsLLM(
  text: string,
  llm: LlmProvider,
): Promise<Requirement[] | null> {
  const out = await chatJson<any[]>(
    llm,
    "You extract software requirements from business requirement documents. " +
      "Reply with a JSON array only. Each item: {id, title, description, acceptanceCriteria}. " +
      "id: use the document's own ID if present, else REQ-1, REQ-2, ... in order. " +
      "acceptanceCriteria: array of short testable statements drawn from the text. " +
      "Do not invent requirements that are not in the text.",
    text.slice(0, 24000),
  );
  if (!Array.isArray(out) || out.length === 0) return null;
  const reqs: Requirement[] = [];
  out.forEach((r, i) => {
    if (!r || !isStr(r.title)) return;
    reqs.push({
      id: isStr(r.id) ? r.id.trim() : `REQ-${i + 1}`,
      title: r.title.trim(),
      description: isStr(r.description) ? r.description.trim() : r.title.trim(),
      acceptanceCriteria: strArr(r.acceptanceCriteria),
      sourceLine: 0,
    });
  });
  return reqs.length ? reqs : null;
}

/**
 * Design test cases for one requirement with the LLM: richer negative and
 * boundary thinking than the templates, in the same TestCase shape.
 */
export async function designCasesLLM(
  req: Requirement,
  llm: LlmProvider,
): Promise<TestCase[] | null> {
  const out = await chatJson<any[]>(
    llm,
    "You are a senior QA engineer designing manual test cases. Reply with a JSON array only. " +
      "Each item: {title, type, preconditions, steps}. type is one of: positive, negative, boundary. " +
      "steps is an array of {do, target, value, expected} where do is one of: " +
      "navigate, enter, click, verify, call, query. Put the expected result on verify steps. " +
      "Produce 3-5 cases: at least one positive, one negative, one boundary. " +
      "Cover the acceptance criteria. Do not invent features the requirement does not mention.",
    `Requirement ${req.id}: ${req.title}\n${req.description}\nAcceptance criteria:\n` +
      (req.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "- (none stated)"),
  );
  if (!Array.isArray(out) || out.length === 0) return null;
  const cases: TestCase[] = [];
  out.forEach((c, i) => {
    if (!c || !isStr(c.title)) return;
    const type = ["positive", "negative", "boundary"].includes(c.type) ? c.type : "positive";
    const steps = (Array.isArray(c.steps) ? c.steps : []).map(toStep).filter(Boolean) as TestStep[];
    if (steps.length === 0) return;
    cases.push({
      id: `TC-${req.id}-L${i + 1}`,
      reqId: req.id,
      title: c.title.trim(),
      type,
      priority: type === "positive" ? "High" : "Medium",
      preconditions: strArr(c.preconditions),
      steps,
    });
  });
  return cases.length ? cases : null;
}

export interface FailureAnalysis {
  rootCause: string;
  evidence: string[];
  suggestedFix: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Failure analyst: reads a Playwright error + DOM/trace context and explains
 * the likely root cause and the concrete fix — the job a senior SDET does
 * when a suite goes red at 2 AM.
 */
export async function analyzeFailureLLM(
  context: { testTitle: string; error: string; domSnippet?: string; healScore?: number },
  llm: LlmProvider,
): Promise<FailureAnalysis | null> {
  const out = await chatJson<any>(
    llm,
    "You are a senior SDET analysing a failed Playwright test. Reply with a JSON object only: " +
      "{rootCause, evidence, suggestedFix, confidence}. evidence is an array of short quotes or " +
      "observations from the error/context. confidence is high, medium or low. " +
      "Be specific: name the locator, the state, or the timing issue. Do not guess beyond the evidence.",
    `Test: ${context.testTitle}\nError:\n${context.error.slice(0, 4000)}\n` +
      (context.domSnippet ? `DOM snapshot (excerpt):\n${context.domSnippet.slice(0, 4000)}\n` : "") +
      (context.healScore !== undefined ? `Healer top-candidate score: ${context.healScore}\n` : ""),
  );
  if (!out || !isStr(out.rootCause) || !isStr(out.suggestedFix)) return null;
  return {
    rootCause: out.rootCause.trim(),
    evidence: strArr(out.evidence),
    suggestedFix: out.suggestedFix.trim(),
    confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "low",
  };
}
