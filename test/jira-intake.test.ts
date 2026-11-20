import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adfToText, extractAcceptanceCriteria } from "../src/jira-intake.js";
import { runPipeline } from "../src/pipeline.js";

test("adfToText renders paragraphs, bullets and headings as plain text", () => {
  const adf = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "As a user I want to log in" }] },
      { type: "heading", content: [{ type: "text", text: "Acceptance Criteria" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Login page loads" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Valid login reaches the dashboard" }] }] },
        ],
      },
    ],
  };
  const text = adfToText(adf);
  assert.match(text, /As a user I want to log in/);
  assert.match(text, /- Login page loads/);
  assert.deepEqual(extractAcceptanceCriteria(text), ["Login page loads", "Valid login reaches the dashboard"]);
});

test("extractAcceptanceCriteria falls back to all bullets without a heading", () => {
  assert.deepEqual(extractAcceptanceCriteria("Notes:\n- First thing\n- Second thing\n"), ["First thing", "Second thing"]);
});

interface Fake { server: Server; baseUrl: string; created: any[]; comments: string[]; attachedTo: string[] }

async function startFakeJira(): Promise<Fake> {
  const created: any[] = [];
  const comments: string[] = [];
  const attachedTo: string[] = [];
  let baseUrl = "";
  const adfDesc = {
    type: "doc", version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "As a registered user, I want to log in to the client application with my username and password, so that I can access the dashboard." }] },
      { type: "paragraph", content: [{ type: "text", text: "Acceptance Criteria" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Login page loads with username and password fields" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Valid credentials log the user in and the dashboard is shown" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Home button is visible after login" }] }] },
        ],
      },
    ],
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", baseUrl || "http://x");
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/rest/api/3/issue/KAN-4") {
      return send(200, {
        key: "KAN-4",
        fields: {
          summary: "Verify user can log in to Rahul Shetty Academy client app",
          description: adfDesc,
          issuetype: { name: "Story", subtask: false },
          attachment: [
            { id: "1001", filename: "mock-data.csv", mimeType: "text/csv", content: `${baseUrl}/content/att-1` },
          ],
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/content/att-1") {
      return send(200, "email,password\nqa.user@example.com,Str0ng!Pass1\n", "text/csv");
    }
    if (req.method === "GET" && url.pathname.startsWith("/rest/api/3/issue/createmeta")) {
      return send(200, { projects: [{ issuetypes: [{ name: "Story", subtask: false }, { name: "Subtask", subtask: true }] }] });
    }
    if (req.method === "POST" && url.pathname === "/rest/api/3/issue") {
      let data = "";
      req.on("data", (c) => (data += c));
      return req.on("end", () => {
        const body = JSON.parse(data);
        created.push(body);
        send(201, { key: "KAN-9" });
      });
    }
    if (req.method === "POST" && /\/issue\/KAN-4\/comment$/.test(url.pathname)) {
      comments.push(url.pathname);
      return send(201, { id: "c1" });
    }
    if (req.method === "POST" && /\/issue\/KAN-4\/attachments$/.test(url.pathname)) {
      attachedTo.push(url.pathname);
      return send(200, [{ id: "a1" }]);
    }
    return send(404, { errorMessages: ["not found: " + url.pathname] });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return { server, baseUrl, created, comments, attachedTo };
}

test("ticket-first pipeline: reads the ticket, creates a sub-task under it, publishes back to it", async () => {
  const fake = await startFakeJira();
  try {
    const outDir = mkdtempSync(join(tmpdir(), "kasuwright-ticket-"));
    const summary = await runPipeline({
      jiraTicket: { cfg: { baseUrl: fake.baseUrl, email: "qa@example.com", apiToken: "tok" }, key: "KAN-4" },
      outDir,
    });
    assert.equal(summary.sourceTicket, "KAN-4");
    assert.equal(summary.requirements, 1);
    assert.ok(summary.testCases >= 3, "cases generated from the ticket's acceptance criteria");
    // Stage 1 read the acceptance criteria off the ticket
    assert.match(summary.stages[0].detail, /3 acceptance criteria/);
    assert.match(summary.stages[0].detail, /mock-data\.csv/);
    // One sub-task created, parented to the source ticket, with the project's subtask type
    assert.equal(fake.created.length, 1);
    assert.equal(fake.created[0].fields.parent.key, "KAN-4");
    assert.equal(fake.created[0].fields.issuetype.name, "Subtask");
    assert.deepEqual(summary.jiraCreated, ["KAN-9"]);
    // Provided mock data was downloaded into the run folder
    assert.ok(existsSync(join(outDir, "ticket-attachments", "mock-data.csv")));
    assert.match(readFileSync(join(outDir, "ticket.md"), "utf8"), /Acceptance Criteria/);
    // Results published back onto the source ticket itself
    assert.equal(fake.comments.length, 1);
    assert.ok(fake.attachedTo.length >= 4, `expected report/scenarios/data/spec attached to KAN-4, got ${fake.attachedTo.length}`);
  } finally {
    fake.server.close();
  }
});
