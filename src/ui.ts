/**
 * v0.6 — Local web UI.
 * `kasuwright ui` starts a small server on 127.0.0.1 and opens a browser
 * page: drop in a BRD, fill the Jira form once (saved on this machine),
 * press RUN, watch the stages live, open the report. No terminal skills
 * needed beyond the one command that starts it.
 *
 * The API token is stored only in ~/.kasuwright/config.json on the user's
 * own machine and is never sent back to the page.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runPipeline, type PipelineSummary, type StageResult } from "./pipeline.js";
import { resolveIssueTypes, type JiraConfig } from "./jira.js";
import { findBrdCandidates, openInBrowser } from "./wizard.js";

export interface UiConfig { jira?: { baseUrl: string; email: string; apiToken: string }; projectKey?: string }

export function configPath(): string {
  return join(homedir(), ".kasuwright", "config.json");
}

export function loadConfig(): UiConfig {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as UiConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: UiConfig): void {
  const p = configPath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

interface RunState {
  id: string;
  status: "running" | "done" | "error";
  stages: StageResult[];
  summary?: PipelineSummary;
  error?: string;
  jiraBaseUrl?: string;
}

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kasuwright — BRD to full test lifecycle</title>
<style>
:root{--bg:#0b1020;--panel:#131a2e;--line:#26314f;--txt:#e8ecf6;--mut:#93a0bd;--acc:#ffb300;--ok:#39d98a;--err:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:26px;margin:0 0 2px}.sub{color:var(--mut);margin:0 0 22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 16px}
.card h2{font-size:16px;margin:0 0 10px;color:var(--acc)}
#drop{border:2px dashed var(--line);border-radius:12px;padding:26px;text-align:center;color:var(--mut);cursor:pointer}
#drop.over{border-color:var(--acc);color:var(--txt)}
textarea{width:100%;min-height:120px;background:#0d1425;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:10px}
input,select{width:100%;background:#0d1425;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px;margin:4px 0 10px}
label{font-size:13px;color:var(--mut)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
button{background:var(--acc);color:#1a1200;border:0;border-radius:10px;padding:12px 20px;font-weight:700;cursor:pointer;font-size:15px}
button.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc);padding:9px 14px;font-size:13px}
button:disabled{opacity:.5;cursor:wait}
#run{width:100%;font-size:17px;padding:15px}
.stage{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.stage b{min-width:210px}
.mut{color:var(--mut)}.ok{color:var(--ok)}.err{color:var(--err)}
a{color:var(--acc)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.hidden{display:none}
</style></head><body><div class="wrap">
<h1>Kasuwright</h1><p class="sub">From BRD to the full test lifecycle — automatic. You just add the BRD and press RUN.</p>

<div class="card"><h2>Step 1 — BRD file</h2>
<div id="drop">Drop your BRD file here, or click to select it (.md / .txt)<input type="file" id="file" accept=".md,.txt,.markdown" class="hidden"></div>
<div class="row" style="margin-top:10px"><span class="mut">Or pick a BRD from this folder:</span><select id="cand" style="width:auto;flex:1"><option value="">— select —</option></select></div>
<div id="fname" class="mut"></div>
<textarea id="brd" placeholder="Your BRD text appears here — you can edit it if needed"></textarea>
</div>

<div class="card"><h2>Step 2 — Jira (optional)</h2>
<label><input type="checkbox" id="usejira" style="width:auto"> Create tickets directly in Jira</label>
<div id="jiraform" class="hidden">
<div class="grid">
<div><label>Jira site URL</label><input id="jurl" placeholder="https://yourteam.atlassian.net"></div>
<div><label>Project key</label><input id="jkey" placeholder="KAN"></div>
<div><label>Jira login email</label><input id="jemail" placeholder="you@company.com"></div>
<div><label>API token (create one at id.atlassian.com)</label><input id="jtoken" type="password" placeholder="ATATT..."></div>
</div>
<div class="row"><button class="ghost" id="testbtn" type="button">Test connection</button><span id="testout" class="mut"></span></div>
<p class="mut" style="margin:8px 0 0">Details are saved only on this computer (~/.kasuwright/config.json). Your token is never sent anywhere except Atlassian.</p>
</div></div>

<button id="run">RUN — full pipeline</button>
<div class="card hidden" id="progress"><h2>Run progress</h2><div id="stages"></div><div id="done" style="margin-top:12px"></div></div>

<script>
var brdFromFile = "";
function $(id){return document.getElementById(id)}
fetch("/api/state").then(function(r){return r.json()}).then(function(s){
  s.candidates.forEach(function(c){var o=document.createElement("option");o.value=c.path;o.textContent=c.name;$("cand").appendChild(o)});
  if(s.jira){$("usejira").checked=true;$("jiraform").classList.remove("hidden");$("jurl").value=s.jira.baseUrl||"";$("jemail").value=s.jira.email||"";$("jkey").value=s.projectKey||"";if(s.jira.hasToken)$("jtoken").placeholder="•••••• saved — leave blank to keep using it"}
  if(s.projectKey && !$("jkey").value)$("jkey").value=s.projectKey;
});
$("cand").addEventListener("change",function(){ if(this.value){$("fname").textContent="Selected: "+this.options[this.selectedIndex].textContent; $("brd").value=""; brdFromFile="";} });
$("drop").addEventListener("click",function(){$("file").click()});
$("drop").addEventListener("dragover",function(e){e.preventDefault();this.classList.add("over")});
$("drop").addEventListener("dragleave",function(){this.classList.remove("over")});
$("drop").addEventListener("drop",function(e){e.preventDefault();this.classList.remove("over");if(e.dataTransfer.files.length)readFile(e.dataTransfer.files[0])});
$("file").addEventListener("change",function(){if(this.files.length)readFile(this.files[0])});
function readFile(f){var r=new FileReader();r.onload=function(){$("brd").value=r.result;brdFromFile=f.name;$("fname").textContent="Loaded: "+f.name;$("cand").value=""};r.readAsText(f)}
$("usejira").addEventListener("change",function(){$("jiraform").classList.toggle("hidden",!this.checked)});
function jiraBody(){return {baseUrl:$("jurl").value.trim(),email:$("jemail").value.trim(),apiToken:$("jtoken").value.trim(),projectKey:$("jkey").value.trim()}}
$("testbtn").addEventListener("click",function(){
  $("testout").textContent="Testing...";
  fetch("/api/test-jira",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(jiraBody())})
  .then(function(r){return r.json()}).then(function(d){
    if(d.ok){$("testout").innerHTML='<span class="ok">Connected: '+d.name+" — project types: "+d.types+"</span>"}
    else{$("testout").innerHTML='<span class="err">'+d.error+"</span>"}
  }).catch(function(e){$("testout").innerHTML='<span class="err">'+e.message+"</span>"});
});
$("run").addEventListener("click",function(){
  var useJira=$("usejira").checked;
  var body={brdText:$("brd").value,brdPath:$("cand").value,projectKey:($("jkey").value.trim()||"QA"),jira:useJira?jiraBody():null};
  if(!body.brdText && !body.brdPath){alert("Add a BRD file first (drop / select / paste)");return}
  $("run").disabled=true;$("progress").classList.remove("hidden");$("stages").innerHTML="";$("done").innerHTML='<span class="mut">Running...</span>';
  fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
  .then(function(r){return r.json()}).then(function(d){
    if(!d.runId){$("done").innerHTML='<span class="err">'+(d.error||"the run could not start")+"</span>";$("run").disabled=false;return}
    var timer=setInterval(function(){
      fetch("/api/run/"+d.runId).then(function(r){return r.json()}).then(function(s){
        $("stages").innerHTML=s.stages.map(function(x){return '<div class="stage"><b>'+x.name+'</b><span>'+x.detail+"</span></div>"}).join("");
        if(s.status==="done"){clearInterval(timer);$("run").disabled=false;
          var links=(s.summary.jiraCreated||[]).map(function(k){return s.jiraBaseUrl?'<a href="'+s.jiraBaseUrl+"/browse/"+k+'" target="_blank">'+k+"</a>":k}).join(", ");
          $("done").innerHTML='<span class="ok">Done!</span> '+s.summary.requirements+" requirements, "+s.summary.testCases+" test cases. "+(links?"Jira: "+links+" ":"")+'<div style="margin-top:10px"><a href="/report/'+s.id+'" target="_blank"><button type="button">Open report</button></a></div>';
        } else if(s.status==="error"){clearInterval(timer);$("run").disabled=false;$("done").innerHTML='<span class="err">Error: '+s.error+"</span>"}
      });
    },700);
  }).catch(function(e){$("done").innerHTML='<span class="err">'+e.message+"</span>";$("run").disabled=false});
});
</script></div></body></html>`;

function readBody(req: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export interface UiServer { server: Server; url: string; runs: Map<string, RunState> }

export function startUiServer(dir: string, port = 0): Promise<UiServer> {
  const runs = new Map<string, RunState>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (code: number, obj: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(PAGE);
      } else if (req.method === "GET" && url.pathname === "/api/state") {
        const cfg = loadConfig();
        json(200, {
          candidates: findBrdCandidates(dir).map((p) => ({ path: p, name: p.split("/").pop() })),
          jira: cfg.jira ? { baseUrl: cfg.jira.baseUrl, email: cfg.jira.email, hasToken: Boolean(cfg.jira.apiToken) } : null,
          projectKey: cfg.projectKey ?? "",
        });
      } else if (req.method === "POST" && url.pathname === "/api/test-jira") {
        const b = await readBody(req);
        const saved = loadConfig();
        const cfg: JiraConfig = {
          baseUrl: String(b.baseUrl ?? "").replace(/\/$/, ""),
          email: String(b.email ?? ""),
          apiToken: String(b.apiToken ?? "") || saved.jira?.apiToken || "",
        };
        if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) return json(200, { ok: false, error: "URL, email and token are all required" });
        const r = await fetch(cfg.baseUrl + "/rest/api/3/myself", {
          headers: { Authorization: "Basic " + Buffer.from(cfg.email + ":" + cfg.apiToken).toString("base64"), Accept: "application/json" },
        });
        if (!r.ok) return json(200, { ok: false, error: "Could not connect to Jira (" + r.status + ") — check the details" });
        const me = (await r.json()) as { displayName?: string };
        const types = await resolveIssueTypes(cfg, String(b.projectKey || "QA"));
        json(200, { ok: true, name: me.displayName ?? cfg.email, types: "Story type: " + types.story + ", sub-task: " + (types.sub ?? "—") });
      } else if (req.method === "POST" && url.pathname === "/api/run") {
        const b = await readBody(req);
        const id = "ui-" + new Date().toISOString().replace(/[:.]/g, "-");
        const outDir = join(dir, "runs", id);
        mkdirSync(outDir, { recursive: true });
        let brdPath = String(b.brdPath ?? "");
        if (!brdPath) {
          const text = String(b.brdText ?? "");
          if (!text.trim()) return json(400, { error: "No BRD text provided" });
          brdPath = join(outDir, "brd.md");
          writeFileSync(brdPath, text);
        } else if (!existsSync(brdPath)) {
          return json(400, { error: "BRD file not found: " + brdPath });
        }
        let jira: JiraConfig | null = null;
        const saved = loadConfig();
        if (b.jira) {
          jira = {
            baseUrl: String(b.jira.baseUrl ?? "").replace(/\/$/, ""),
            email: String(b.jira.email ?? ""),
            apiToken: String(b.jira.apiToken ?? "") || saved.jira?.apiToken || "",
          };
          if (!jira.baseUrl || !jira.email || !jira.apiToken) jira = null;
          else saveConfig({ jira, projectKey: String(b.projectKey || "QA") });
        }
        const state: RunState = { id, status: "running", stages: [], jiraBaseUrl: jira?.baseUrl };
        runs.set(id, state);
        const projectKey = String(b.projectKey || saved.projectKey || "QA");
        void (async () => {
          try {
            state.summary = await runPipeline({
              brdPath,
              outDir,
              projectKey,
              jira,
              onStage: (s) => state.stages.push(s),
            });
            state.status = "done";
          } catch (e) {
            state.status = "error";
            state.error = e instanceof Error ? e.message : String(e);
          }
        })();
        json(200, { runId: id });
      } else if (req.method === "GET" && url.pathname.startsWith("/api/run/")) {
        const st = runs.get(url.pathname.slice("/api/run/".length));
        if (!st) return json(404, { error: "run not found" });
        json(200, st);
      } else if (req.method === "GET" && url.pathname.startsWith("/report/")) {
        const id = url.pathname.slice("/report/".length);
        if (!/^ui-[\w-]+$/.test(id)) return json(400, { error: "bad id" });
        const p = join(dir, "runs", id, "report.html");
        if (!existsSync(p)) return json(404, { error: "report not ready" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(p, "utf8"));
      } else {
        json(404, { error: "not found" });
      }
    } catch (e) {
      json(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, runs });
    });
  });
}

/** CLI entry: start the UI in the current folder and open the browser. */
export async function startUi(dir: string): Promise<void> {
  const { url } = await startUiServer(dir, 4321).catch(() => startUiServer(dir, 0));
  console.log(`Kasuwright UI: ${url}`);
  console.log("The page is opening in your browser. Press Ctrl+C to stop.");
  openInBrowser(url);
  await new Promise(() => { /* run until Ctrl+C */ });
}
