import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEDULES, isScheduleKey, scheduledJenkinsfile, jenkinsJobConfigXml, jenkinsSetupReadme } from "../src/cicd.js";
import { runPipeline } from "../src/pipeline.js";

const opts = { schedule: "nightly" as const, projectKey: "KAN", reportEmail: "qa@example.com", appUrl: "https://app.example.com/login", ticketKey: "KAN-4" };

test("schedule presets are valid keys with cron expressions", () => {
  assert.ok(isScheduleKey("nightly"));
  assert.ok(isScheduleKey("weekdays"));
  assert.ok(!isScheduleKey("hourly"));
  assert.equal(SCHEDULES.nightly.cron, "H 2 * * *");
});

test("scheduled Jenkinsfile carries the cron trigger, the ticket command and result emails", () => {
  const jf = scheduledJenkinsfile(opts);
  assert.match(jf, /triggers \{\s*cron\('H 2 \* \* \*'\)/);
  assert.match(jf, /--jira-ticket KAN-4/);
  assert.match(jf, /--url https:\/\/app\.example\.com\/login/);
  assert.match(jf, /evidence\.xlsx/);
  assert.match(jf, /mail to: 'qa@example\.com'/);
});

test("job config XML embeds the schedule and the pipeline script", () => {
  const xml = jenkinsJobConfigXml(opts);
  assert.match(xml, /<spec>H 2 \* \* \*<\/spec>/);
  assert.match(xml, /TimerTrigger/);
  assert.match(xml, /CpsFlowDefinition/);
  assert.match(xml, /Kasuwright scheduled pipeline/);
});

test("setup readme explains import and manual routes", () => {
  const md = jenkinsSetupReadme(opts);
  assert.match(md, /create-job kasuwright-scheduled/);
  assert.match(md, /Build periodically/);
});

test("pipeline emits the Jenkins pack only when opted in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kasuwright-cicd-"));
  const brd = join(dir, "brd.md");
  writeFileSync(brd, "# REQ-1 Login\n\nREQ-1: The system shall allow user login.\n");
  const withPack = await runPipeline({ brdPath: brd, outDir: join(dir, "with"), jenkins: { schedule: "weekly" } });
  assert.ok(existsSync(join(dir, "with", "jenkins", "Jenkinsfile")));
  assert.ok(existsSync(join(dir, "with", "jenkins", "job-config.xml")));
  assert.ok(existsSync(join(dir, "with", "jenkins", "README-jenkins.md")));
  const stage10 = withPack.stages.find((s) => s.name.startsWith("10."));
  assert.match(stage10?.detail ?? "", /Weekly/);
  assert.match(readFileSync(join(dir, "with", "jenkins", "Jenkinsfile"), "utf8"), /H 3 \* \* 1/);

  const without = await runPipeline({ brdPath: brd, outDir: join(dir, "without") });
  assert.ok(!existsSync(join(dir, "without", "jenkins")));
  assert.ok(without.stages.length > 0);
});
