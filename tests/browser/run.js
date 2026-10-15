#!/usr/bin/env node
/*
 * Drive the real app in a real Chrome.
 *
 * The node suite covers the decisions: state, prompts, escaping, and the
 * service worker's handlers against a fake cache. It cannot see what a
 * rendered screen does with them, or how a real browser treats a real service
 * worker. This serves the app over loopback, opens it in headless Chrome, and
 * works it through the DevTools protocol the way a person would -- typing,
 * clicking, reloading, going offline.
 *
 *   node tests/browser/run.js              the working copy
 *   node tests/browser/run.js --original    the code at the Initial commit
 *
 * In --original mode every check named "regression:" must fail and every
 * other check must pass. A regression check that passes against the original
 * is not testing the defect it names.
 *
 * No dependency: the server is Node's http module, and Chrome is driven with
 * Node's own WebSocket and fetch. It prints SKIP and exits 0 if no Chrome is
 * found, which is why it is not part of `npm test` -- a skip there would read
 * as a pass.
 */

"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ORIGINAL = process.argv.includes("--original");

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- the source --- */

/* The app's files at the Initial commit, written to a temporary directory. */
function extractOriginal() {
  const sha = execFileSync("git", ["log", "--all", "--format=%H", "--grep=^Initial commit$", "--max-count=1"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (!sha) throw new Error('no commit with the subject "Initial commit"');
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", sha], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assignmentwizard-original-"));
  for (const file of files) {
    const bytes = execFileSync("git", ["show", `${sha}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), bytes);
  }
  return { sha, dir };
}

/* --------------------------------------------------------------- serving --- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};

/*
 * A static server that can be stopped and started again on the same port --
 * stopped is how a check goes offline -- and whose files can be replaced with
 * `deploy`, which is how a check ships a new version. `no-cache` keeps the
 * browser's HTTP cache out of it, so what is observed is the service worker.
 */
class AppServer {
  constructor(dir) {
    this.dir = dir;
    this.overrides = new Map();
    this.port = 0;
    this.server = null;
  }

  deploy(file, content) {
    this.overrides.set(file, content);
  }

  handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const headers = (file) => ({
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    if (this.overrides.has(rel)) {
      res.writeHead(200, headers(rel)).end(this.overrides.get(rel));
      return;
    }
    const file = path.resolve(this.dir, rel);
    if (!file.startsWith(path.resolve(this.dir) + path.sep)) {
      res.writeHead(403).end("no");
      return;
    }
    try {
      const body = fs.readFileSync(file);
      res.writeHead(200, headers(file)).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  }

  start() {
    this.server = createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  stop() {
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  url(p = "") {
    return `http://127.0.0.1:${this.port}/${p}`;
  }
}

/* ---------------------------------------------------------------- chrome --- */

function findChrome() {
  return CHROME_CANDIDATES.find((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  });
}

async function launchChrome(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "assignmentwizard-chrome-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-component-update",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  child.stderr.resume();

  const portFile = path.join(profile, "DevToolsActivePort");
  let port = 0;
  for (const deadline = Date.now() + 30000; Date.now() < deadline && !port; await sleep(50)) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode} before listening`);
    try {
      port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) || 0;
    } catch {
      /* not written yet */
    }
  }
  if (!port) throw new Error("Chrome never wrote DevToolsActivePort");

  let wsUrl = null;
  for (const deadline = Date.now() + 30000; Date.now() < deadline && !wsUrl; await sleep(50)) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
  }
  if (!wsUrl) throw new Error("no debuggable page target appeared");

  const page = new Page(wsUrl);
  await page.open();
  return {
    page,
    close() {
      page.close();
      child.kill();
      for (let i = 0; i < 20; i++) {
        try {
          fs.rmSync(profile, { recursive: true, force: true });
          return;
        } catch {
          /* Chrome still holds the profile for a moment after exit */
        }
        const until = Date.now() + 100;
        while (Date.now() < until) {
          /* synchronous back-off; close() is called from a finally */
        }
      }
    },
  };
}

/* A page target driven over the DevTools protocol. */
class Page {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", async () => {
        try {
          await this.send("Runtime.enable");
          await this.send("Page.enable");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      this.ws.addEventListener("error", () => reject(new Error("the DevTools websocket errored")));
      this.ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        } else if (msg.method === "Runtime.exceptionThrown") {
          const d = msg.params.exceptionDetails;
          this.exceptions.push(`${d.text} ${(d.exception && d.exception.description) || ""}`.trim());
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.nextId++;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /* Evaluate an expression in the page and return its value (awaiting a promise). */
  async eval(expression) {
    const out = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) {
      const d = out.exceptionDetails;
      throw new Error(`in page: ${(d.exception && d.exception.description) || d.text}`);
    }
    return out.result.value;
  }

  /* Navigate, and wait until the document has finished loading. */
  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete' && location.href !== 'about:blank'");
  }

  async reload() {
    const before = await this.eval("performance.timeOrigin");
    await this.send("Page.reload", { ignoreCache: false });
    await this.waitFor(`performance.timeOrigin !== ${before} && document.readyState === 'complete'`);
  }

  async waitFor(expression, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return;
      } catch (e) {
        last = e; // mid-navigation, the context can vanish under an evaluate
      }
      await sleep(50);
    }
    throw new Error(`timed out waiting for: ${expression}${last ? ` (last error: ${last.message})` : ""}`);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/* --------------------------------------------------------- page helpers --- */

const js = JSON.stringify;
const click = (sel) => `(() => { const el = document.querySelector(${js(sel)}); if (!el) throw new Error("no " + ${js(sel)}); el.click(); return true; })()`;
const type = (sel, value) =>
  `(() => { const el = document.querySelector(${js(sel)}); if (!el) throw new Error("no " + ${js(sel)});
     el.value = ${js(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
const valueOf = (sel) => `(() => { const el = document.querySelector(${js(sel)}); return el ? el.value : null; })()`;
const exists = (sel) => `!!document.querySelector(${js(sel)})`;

/* A fresh app: no saved projects, loaded from the server. */
async function freshApp(page, server) {
  await page.goto(server.url("index.html"));
  await page.eval("localStorage.clear(), true");
  await page.reload();
  await page.waitFor(exists("#project-name"));
}

/* Create a project through the Setup screen and land on Extract. */
async function startProject(page, name) {
  await page.eval(type("#project-name", name));
  await page.eval(click("#start-btn"));
  await page.waitFor(exists("#extraction-prompt"));
}

/* From Extract, on through Preferences to Draft. */
async function onToDraft(page) {
  await page.eval(click("#next-btn"));
  await page.waitFor(exists("#referencing-select"));
  await page.eval(click("#next-btn"));
  await page.waitFor(exists("#drafting-prompt"));
}

/* ----------------------------------------------------------------- checks --- */

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check("the browser's own text escaping leaves quotes alone, as the node harness assumes", async ({ page, server }) => {
  await page.goto(server.url("index.html"));
  const out = await page.eval(
    `(() => { const d = document.createElement("div"); d.textContent = 'a "b" <c> & d'; return d.innerHTML; })()`
  );
  if (out !== 'a "b" &lt;c&gt; &amp; d') throw new Error(`innerHTML gave ${js(out)}`);
});

check("the app loads with no uncaught exception and shows Setup", async ({ page, server }) => {
  page.exceptions.length = 0;
  await freshApp(page, server);
  if (page.exceptions.length) throw new Error(page.exceptions.join("\n"));
});

check("a project can be named and walked through to a drafting prompt", async ({ page, server }) => {
  await freshApp(page, server);
  await startProject(page, "Marketing Ethics Essay");
  const extraction = await page.eval(valueOf("#extraction-prompt"));
  if (!extraction.includes('"Marketing Ethics Essay"')) throw new Error("extraction prompt lacks the name");
  await page.eval(click("#next-btn"));
  await page.waitFor(exists("#word-count-value"));
  await page.eval(type("#word-count-value", "1500"));
  await page.eval(click("#next-btn"));
  await page.waitFor(exists("#drafting-prompt"));
  const draft = await page.eval(valueOf("#drafting-prompt"));
  if (!draft.includes('for "Marketing Ethics Essay"')) throw new Error("drafting prompt lacks the name");
  if (!draft.includes("between 1350 and 1500 words")) throw new Error("drafting prompt ignores the word count typed in Preferences");
});

check("regression: a project name with quotes in it survives a visit back to Setup", async ({ page, server }) => {
  await freshApp(page, server);
  const name = 'Essay on "1984"';
  await startProject(page, name);
  await onToDraft(page);
  await page.eval(type("#drafting-prompt", "my edited drafting prompt"));

  await page.eval(click('.stepper-item[data-index="0"]'));
  await page.waitFor(exists("#project-name"));
  const shown = await page.eval(valueOf("#project-name"));
  await page.eval(click("#start-btn"));
  await page.waitFor(exists("#extraction-prompt"));
  const saved = await page.eval("JSON.stringify([state.get().projectName, state.get().highestPhaseReached, state.get().phase3_draftingPromptOverrideBasic])");

  const problems = [];
  if (shown !== name) problems.push(`Setup showed the name as ${js(shown)}`);
  const [savedName, highest, edit] = JSON.parse(saved);
  if (savedName !== name) problems.push(`pressing Save renamed the project to ${js(savedName)}`);
  if (highest !== 3) problems.push(`Draft went back to "not reached" (highest phase ${highest})`);
  if (edit !== "my edited drafting prompt") problems.push("the edited drafting prompt was thrown away");
  if (problems.length) throw new Error(problems.join("; "));
});

check("regression: Switch assessment works from the Setup screen of a new assessment", async ({ page, server }) => {
  await freshApp(page, server);
  await startProject(page, "First essay");
  await onToDraft(page);
  await page.eval(click("#restart-btn")); // "Start a new assessment"
  await page.waitFor(`${exists("#project-name")} && document.querySelector("#project-name").value === ""`);

  await page.eval(click("#switch-project-btn"));
  await sleep(200);
  if (!(await page.eval(exists(".project-list")))) {
    throw new Error("the button did nothing: still on the Setup screen, and the picker never appeared");
  }
});

check("regression: pressing the preference that is already selected keeps the edited drafting prompt", async ({ page, server }) => {
  await freshApp(page, server);
  await startProject(page, "Essay");
  await onToDraft(page);
  await page.eval(type("#drafting-prompt", "my edited drafting prompt"));

  await page.eval(click("#back-btn"));
  await page.waitFor(exists("#referencing-select"));
  await page.eval(click('.toggle-option.is-selected[data-field="wordCountMode"]'));
  await page.waitFor(exists("#referencing-select"));
  await page.eval(click("#next-btn"));
  await page.waitFor(exists("#drafting-prompt"));

  const shown = await page.eval(valueOf("#drafting-prompt"));
  if (shown !== "my edited drafting prompt") throw new Error("the edited prompt was replaced by a freshly generated one");
});

/* The service worker checks run last and in this order: each builds on the last. */

check("the service worker installs and controls the page", async ({ page, server }) => {
  await page.goto(server.url("index.html"));
  await page.eval("navigator.serviceWorker.ready.then(() => true)");
  if (!(await page.eval("!!navigator.serviceWorker.controller"))) {
    await page.reload();
  }
  await page.waitFor("!!navigator.serviceWorker.controller");
});

check("regression: a deployed change reaches the page on the next load, without a CACHE_NAME bump", async ({ page, server, source }) => {
  const html = fs.readFileSync(path.join(source, "index.html"), "utf8");
  server.deploy("index.html", html.replace("<head>", '<head>\n<meta name="deployed" content="v2" />'));
  await page.reload();
  const seen = await page.eval(`(() => { const m = document.querySelector('meta[name="deployed"]'); return m ? m.content : null; })()`);
  server.overrides.clear();
  if (seen !== "v2") throw new Error("after a reload the page is still the version the service worker cached first");
  await page.reload();
});

check("offline, the app still opens", async ({ page, server }) => {
  await page.goto(server.url("index.html"));
  await page.waitFor("!!navigator.serviceWorker.controller");
  await server.stop();
  try {
    await page.goto(server.url("index.html"));
    await page.waitFor(exists("#right-pane .phase-card"), 5000);
  } finally {
    await server.start();
  }
});

check("regression: offline, the app opens from a link with a query string", async ({ page, server }) => {
  await page.goto(server.url("index.html"));
  await page.waitFor("!!navigator.serviceWorker.controller");
  await server.stop();
  try {
    await page.goto(server.url("?utm_source=homescreen"));
    const ok = await page
      .waitFor(exists("#right-pane .phase-card"), 5000)
      .then(() => true)
      .catch(() => false);
    if (!ok) throw new Error(`the browser showed its own offline error page (${await page.eval("location.href")})`);
  } finally {
    await server.start();
  }
});

/* ------------------------------------------------------------------- main --- */

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("SKIP: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run these checks.");
    return 0;
  }

  let original = null;
  let source = ROOT;
  if (ORIGINAL) {
    original = extractOriginal();
    source = original.dir;
    console.log(`Against the Initial commit ${original.sha.slice(0, 7)}`);
  }

  const server = new AppServer(source);
  await server.start();
  const browser = await launchChrome(chrome);
  const results = [];
  try {
    for (const { name, fn } of checks) {
      try {
        await fn({ page: browser.page, server, source });
        results.push({ name, ok: true });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  } finally {
    browser.close();
    if (server.server) await server.stop();
    if (original) fs.rmSync(original.dir, { recursive: true, force: true });
  }

  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : `\n        ${r.detail}`}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} checks`);

  if (!ORIGINAL) return failed.length === 0 ? 0 : 1;

  const wrong = results.filter((r) => r.name.startsWith("regression:") === r.ok);
  if (wrong.length) {
    console.error("\nAgainst the original, every regression check must fail and every other check must pass. These did not:");
    for (const r of wrong) console.error(`  - ${r.ok ? "passed" : "failed"}: ${r.name}`);
    return 1;
  }
  console.log(`\nAgainst the original: all ${results.filter((r) => r.name.startsWith("regression:")).length} regression checks fail, as they should.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  }
);
