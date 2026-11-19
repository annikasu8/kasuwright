import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUiServer } from "../src/ui.js";

test("web UI serves the page and runs a pipeline from posted BRD text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kasu-ui-"));
  const { server, url } = await startUiServer(dir, 0);
  try {
    const home = await (await fetch(url + "/")).text();
    assert.match(home, /Kasuwright/);
    assert.match(home, /RUN/);

    const state = (await (await fetch(url + "/api/state")).json()) as { candidates: unknown[] };
    assert.ok(Array.isArray(state.candidates));

    const started = (await (
      await fetch(url + "/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brdText: "# REQ-301: Password reset\n\nUsers can reset their password through an email link.\n\nAcceptance Criteria:\n- Reset link expires in 30 minutes\n",
          projectKey: "QA",
          jira: null,
        }),
      })
    ).json()) as { runId: string };
    assert.ok(started.runId);

    let final: any = null;
    for (let i = 0; i < 40; i++) {
      final = await (await fetch(url + "/api/run/" + started.runId)).json();
      if (final.status !== "running") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(final.status, "done");
    assert.equal(final.summary.requirements, 1);
    assert.ok(final.stages.length >= 8, `stages streamed live: ${final.stages.length}`); // 8 in export mode; 11 with Jira

    const report = await (await fetch(url + "/report/" + started.runId)).text();
    assert.match(report, /Traceability/);
  } finally {
    server.close();
  }
});
