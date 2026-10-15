/*
 * sw.js, driven through its install, activate and fetch handlers in a fake
 * service-worker global (see loadWorker in harness.js). The browser suite
 * checks the two behaviours that matter most against a real worker in Chrome:
 * that a deploy reaches the page, and that the app opens offline.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadWorker, BASE } = require("./harness.js");

const REVS = ["original", "working"];
const OFFLINE = () => {
  throw new TypeError("Failed to fetch");
};
const body = async (res) => (res && typeof res.text === "function" ? res.text() : res);
const isResponse = (r) => !!r && typeof r.status === "number" && typeof r.clone === "function";

function currentCacheName(worker) {
  return worker.run("CACHE_NAME");
}

/* A worker whose network serves every app-shell file, installed and activated. */
async function installed(rev, network) {
  const worker = loadWorker({
    rev,
    network: (req) => (network ? network(req) : new Response(`shell ${new URL(req.url).pathname}`)),
  });
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  return worker;
}

/* ------------------------------------------------------------------ *
 * What the original got wrong
 * ------------------------------------------------------------------ */

test("regression: a deployed file reaches the page without anyone bumping CACHE_NAME", async () => {
  const outcome = {};
  for (const rev of REVS) {
    let version = "old";
    const worker = await installed(rev, (req) => new Response(`${version} ${new URL(req.url).pathname}`));
    version = "new"; // deployed; sw.js itself unchanged, so no new worker installs
    const { response } = await worker.dispatchFetch(worker.get("js/app.js"));
    outcome[rev] = await body(response);
  }
  // Cache-first answered from the install-time cache for as long as that
  // worker lived, and an unchanged sw.js means it lives until someone edits
  // CACHE_NAME by hand.
  assert.strictEqual(outcome.original, "old /js/app.js");
  assert.strictEqual(outcome.working, "new /js/app.js");
});

test("regression: a 404 is not kept and served after the file comes back", async () => {
  const outcome = {};
  for (const rev of REVS) {
    let up = false;
    const worker = await installed(rev, (req) =>
      new URL(req.url).pathname === "/icons/late.png" && !up ? new Response("gone", { status: 404 }) : new Response("image")
    );
    await worker.dispatchFetch(worker.get("icons/late.png")); // mid-deploy, say
    up = true;
    const { response } = await worker.dispatchFetch(worker.get("icons/late.png"));
    outcome[rev] = response.status;
  }
  assert.strictEqual(outcome.original, 404);
  assert.strictEqual(outcome.working, 200);
});

test("regression: offline, a navigation the cache has no exact entry for opens the app", async () => {
  const outcome = {};
  for (const rev of REVS) {
    let online = true;
    const worker = await installed(rev, (req) => {
      if (!online) OFFLINE();
      return new Response(`shell ${new URL(req.url).pathname}`);
    });
    online = false;
    const { response } = await worker.dispatchFetch(worker.navigate("index.html?utm_source=homescreen"));
    outcome[rev] = isResponse(response) ? await response.text() : response;
  }
  // The original's `.catch(() => cached)` only ran when `cached` was already
  // undefined, and respondWith(undefined) is a network error.
  assert.strictEqual(outcome.original, undefined);
  assert.strictEqual(outcome.working, "shell /index.html");
});

test("regression: install fetches the app shell past the HTTP cache", async () => {
  const outcome = {};
  for (const rev of REVS) {
    const worker = loadWorker({ rev, network: () => new Response("x") });
    await worker.lifecycle("install");
    outcome[rev] = [...new Set(worker.networkLog.map((r) => r.cache))];
  }
  // Without it a new worker can fill its new cache with the old files the
  // browser still holds, which is the stale copy the new worker exists to
  // replace.
  assert.deepStrictEqual(outcome.original, ["default"]);
  assert.deepStrictEqual(outcome.working, ["reload"]);
});

/* ------------------------------------------------------------------ *
 * Behaviour to keep
 * ------------------------------------------------------------------ */

test("install caches every file in APP_SHELL and takes over without waiting", async () => {
  // The review said the worker lacked skipWaiting and clients.claim. It has
  // had both since the first commit.
  for (const rev of REVS) {
    const worker = await installed(rev);
    const shell = worker.run("APP_SHELL");
    const cache = worker.stores.get(currentCacheName(worker));
    for (const file of shell) assert.ok(cache.entries.has(new URL(file, BASE).href), `${rev}: ${file}`);
    assert.strictEqual(worker.calls.skipWaiting, 1, rev);
    assert.strictEqual(worker.calls.claim, 1, rev);
  }
});

test("install fails if a shell file cannot be fetched, so a broken deploy never takes over", async () => {
  const worker = loadWorker({
    network: (req) => (req.url.endsWith("styles.css") ? new Response("", { status: 404 }) : new Response("x")),
  });
  await assert.rejects(worker.lifecycle("install"));
});

test("activate deletes every other cache, including the ones the original filled", async () => {
  const worker = loadWorker({
    network: () => new Response("x"),
    caches: {
      "assignmentwizard-v3": { "https://app.test/js/app.js": new Response("old") },
      "assignmentwizard-v2": {},
    },
  });
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.deepStrictEqual([...worker.stores.keys()], [currentCacheName(worker)]);
  assert.notStrictEqual(currentCacheName(worker), "assignmentwizard-v3");
});

test("online, a fetched file is stored for next time offline", async () => {
  let online = true;
  let version = "v1";
  const worker = await installed("working", (req) => {
    if (!online) OFFLINE();
    return new Response(`${version} ${new URL(req.url).pathname}`);
  });
  version = "v2";
  await worker.dispatchFetch(worker.get("js/state.js"));
  online = false;
  const { response } = await worker.dispatchFetch(worker.get("js/state.js"));
  assert.strictEqual(await response.text(), "v2 /js/state.js");
});

test("offline, a file that was never cached is a network error rather than a hang or a stand-in page", async () => {
  let online = true;
  const worker = await installed("working", (req) => (online ? new Response("x") : OFFLINE()));
  online = false;
  const { response } = await worker.dispatchFetch(worker.get("js/never-cached.js"));
  assert.strictEqual(response.type, "error");
});

test("a network that hangs falls back to the cached copy when the timer fires", async () => {
  let hang = false;
  const worker = await installed("working", (req) => (hang ? new Promise(() => {}) : new Response(`shell ${new URL(req.url).pathname}`)));
  hang = true;
  const pending = worker.dispatchFetch(worker.get("js/app.js"));
  await new Promise((r) => setImmediate(r));
  worker.fireTimers();
  const { response } = await pending;
  assert.strictEqual(await response.text(), "shell /js/app.js");
});

test("a slow network with nothing cached is waited for, not abandoned", async () => {
  let release;
  const worker = await installed("working", (req) =>
    new URL(req.url).pathname === "/slow.js" ? new Promise((r) => (release = r)) : new Response("x")
  );
  const pending = worker.dispatchFetch(worker.get("slow.js"));
  await new Promise((r) => setImmediate(r));
  worker.fireTimers();
  release(new Response("arrived"));
  const { response } = await pending;
  assert.strictEqual(await response.text(), "arrived");
});

test("a server error is passed through, not stored", async () => {
  let failing = false;
  const worker = await installed("working", (req) =>
    failing && new URL(req.url).pathname === "/js/app.js" ? new Response("oops", { status: 500 }) : new Response("x")
  );
  failing = true;
  const before = await worker.stores.get(currentCacheName(worker)).match(worker.get("js/app.js")).then((r) => r.text());
  const { response } = await worker.dispatchFetch(worker.get("js/app.js"));
  assert.strictEqual(response.status, 500);
  const after = await worker.stores.get(currentCacheName(worker)).match(worker.get("js/app.js")).then((r) => r.text());
  assert.strictEqual(after, before);
});

test("the Google Fonts files are served from the cache first, and an opaque response is kept", async () => {
  let online = true;
  const opaque = () => ({ status: 0, ok: false, type: "opaque", clone() { return this; }, text: async () => "font" });
  const worker = await installed("working", (req) => {
    if (!online) OFFLINE();
    return req.url.startsWith("https://fonts.") ? opaque() : new Response("x");
  });
  const css = "https://fonts.googleapis.com/css2?family=Inter";
  await worker.dispatchFetch(worker.get(css));
  online = false;
  const { response } = await worker.dispatchFetch(worker.get(css));
  assert.strictEqual(response.type, "opaque");
});

test("anything but GET is left to the browser", async () => {
  for (const rev of REVS) {
    const worker = await installed(rev);
    const { handled } = await worker.dispatchFetch(new Request(`${BASE}anything`, { method: "POST", body: "x" }));
    assert.strictEqual(handled, false, rev);
  }
});
