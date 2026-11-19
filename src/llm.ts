/**
 * LLM provider layer (v0.3).
 *
 * Provider-agnostic: any OpenAI-compatible chat-completions endpoint works
 * (OpenAI, Azure OpenAI, Ollama, OpenRouter, ...). The layer is OPTIONAL —
 * every feature that uses it has a deterministic fallback, so Kasuwright
 * works fully offline with no API key.
 *
 * Configuration (environment variables):
 *   KASUWRIGHT_LLM_API_KEY   — required to enable LLM features
 *   KASUWRIGHT_LLM_MODEL     — default "gpt-4o-mini"
 *   KASUWRIGHT_LLM_BASE_URL  — default "https://api.openai.com/v1"
 *
 * Tests and offline demos can inject any object matching LlmProvider.
 */

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmProvider {
  name: string;
  model: string;
  /** Send messages, return the assistant's text reply. Throws on failure. */
  chat(messages: LlmMessage[]): Promise<string>;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible";
  constructor(
    private apiKey: string,
    readonly model: string = "gpt-4o-mini",
    private baseUrl: string = "https://api.openai.com/v1",
  ) {}

  async chat(messages: LlmMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.2 }),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("LLM returned an empty response");
    return text;
  }
}

/** Build a provider from env, or return null when no key is configured. */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  const key = env.KASUWRIGHT_LLM_API_KEY;
  if (!key) return null;
  return new OpenAiCompatibleProvider(
    key,
    env.KASUWRIGHT_LLM_MODEL || "gpt-4o-mini",
    env.KASUWRIGHT_LLM_BASE_URL || "https://api.openai.com/v1",
  );
}

/**
 * Ask the model for JSON and parse it defensively: strips code fences and
 * any prose around the first JSON object/array. Returns null on any failure
 * so callers can fall back to deterministic logic.
 */
export async function chatJson<T>(llm: LlmProvider, system: string, user: string): Promise<T | null> {
  try {
    const raw = await llm.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const cleaned = raw.replace(/```(?:json)?/gi, "");
    const start = cleaned.search(/[[{]/);
    if (start < 0) return null;
    const open = cleaned[start];
    const close = open === "[" ? "]" : "}";
    const end = cleaned.lastIndexOf(close);
    if (end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Deterministic mock provider for tests and offline demos. */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  constructor(
    readonly model: string = "mock-1",
    private responder: (messages: LlmMessage[]) => string,
  ) {}
  async chat(messages: LlmMessage[]): Promise<string> {
    return this.responder(messages);
  }
}
