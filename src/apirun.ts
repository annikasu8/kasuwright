/**
 * Stage 5b — API flow testing.
 * A small runner for API scenarios (the UI and DB flows live in the
 * generated Playwright framework and db/validations.sql). Scenarios run
 * with plain fetch — no extra dependencies — and return structured results
 * the report stage consumes.
 */
export interface ApiStep {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus: number;
}

export interface ApiResult {
  name: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
}

export async function runApiScenario(steps: ApiStep[], baseUrl: string): Promise<ApiResult[]> {
  const results: ApiResult[] = [];
  for (const s of steps) {
    const t0 = Date.now();
    try {
      const res = await fetch(new URL(s.url, baseUrl), {
        method: s.method,
        headers: { "Content-Type": "application/json", ...(s.headers ?? {}) },
        body: s.body === undefined ? undefined : JSON.stringify(s.body),
      });
      results.push({
        name: s.name,
        ok: res.status === s.expectStatus,
        status: res.status,
        durationMs: Date.now() - t0,
        ...(res.status === s.expectStatus ? {} : { error: `expected HTTP ${s.expectStatus}, got ${res.status}` }),
      });
    } catch (e) {
      results.push({ name: s.name, ok: false, durationMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Starter API scenarios for the most common BRD flow (login), driven by Stage-4 data rows. */
export function loginApiScenarios(valid: Record<string, string>, invalid: Record<string, string>): ApiStep[] {
  return [
    { name: "API: login with valid credentials succeeds", method: "POST", url: "/api/login", body: { email: valid.email, password: valid.password }, expectStatus: 200 },
    { name: "API: login with invalid credentials is rejected", method: "POST", url: "/api/login", body: { email: invalid.email, password: invalid.password }, expectStatus: 401 },
    { name: "API: login with empty body is a client error", method: "POST", url: "/api/login", body: {}, expectStatus: 400 },
  ];
}
