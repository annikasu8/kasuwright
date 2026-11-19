import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.js";

interface Seen { creates: number; comments: string[]; attachments: string[] }

async function fakeJira(seen: Seen): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = req.url ?? "";
      if (req.method === "POST" && u === "/rest/api/3/issue") {
        seen.creates++;
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ key: `QA-${seen.creates}` }));
      } else if (req.method === "POST" && /\/issue\/[^/]+\/comment$/.test(u)) {
        seen.comments.push(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end("{}");
      } else if (req.method === "POST" && /\/issue\/[^/]+\/attachments$/.test(u)) {
        seen.attachments.push(u + "|" + body.slice(0, 400));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      } else {
        res.writeHead(404); res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test("pipeline closes the Jira loop: creates, comments and attaches artefacts", async () => {
  const seen: Seen = { creates: 0, comments: [], attachments: [] };
  const { server, url } = await fakeJira(seen);
  const prev = { ...process.env };
  process.env.JIRA_BASE_URL = url;
  process.env.JIRA_EMAIL = "qa@example.com";
  process.env.JIRA_API_TOKEN = "test-token";
  try {
    const dir = mkdtempSync(join(tmpdir(), "kasu-jira-"));
    const brd = join(dir, "BRD.md");
    writeFileSync(brd, "# REQ-201: Password reset\n\nThe system shall allow password reset by email link.\n\nAcceptance Criteria:\n- Reset link expires in 30 minutes\n");
    const summary = await runPipeline({ brdPath: brd, outDir: join(dir, "run"), projectKey: "QA" });
    assert.equal(seen.creates % 2, 0); // Story + QA sub-task per requirement
    assert.ok(seen.creates >= 2);
    assert.ok(seen.comments.length >= 1); // publish-back on each Story
    assert.match(seen.comments[0], /Kasuwright run complete/);
    const names = seen.attachments.join(" ");
    assert.match(names, /manual-scenarios-req-201\.md/);
    assert.match(names, /test-data-req-201\.csv/);
    assert.match(names, /report\.html/);
    const stage11 = summary.stages.find((s) => s.name.startsWith("11."));
    assert.ok(stage11, "stage 11 present");
    assert.match(stage11!.detail, /QA-1/);
  } finally {
    process.env = prev;
    server.close();
  }
});
