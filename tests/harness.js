/*
 * Loads the app's classic scripts -- the real files, in the order index.html
 * lists them -- into a node:vm context with just enough of a browser around
 * them: a localStorage, crypto, and a document that can do the one thing the
 * original escapeHtml asked of it.
 *
 * Every script shares one global scope, as it does on the page, so a function
 * declared in utils.js is visible to prompts.js. Top-level `const`s and `let`s
 * go into the context's lexical scope and never appear as properties of the
 * sandbox object, so read them by evaluating an expression in the context
 * (`app.run("state.get()")`) rather than off `context.`.
 *
 * `rev: "original"` loads each file from the baseline commit instead of the
 * working tree. Every test whose name starts with "regression:" runs its
 * scenario against both and asserts the original gets it wrong, so a check
 * that stops exercising its defect fails here rather than passing quietly.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { webcrypto } = require("node:crypto");

const ROOT = path.join(__dirname, "..");

/*
 * The commit the project was in when this pass started. Looked up by subject
 * so that an amended or rebased history fails loudly instead of quietly
 * testing the wrong bytes.
 */
const BASELINE_SUBJECT = "Initial commit";

let cachedBaseline = null;
function baselineSha() {
  if (cachedBaseline) return cachedBaseline;
  const out = execFileSync(
    "git",
    ["log", "--all", "--format=%H", "--grep=^" + BASELINE_SUBJECT + "$", "--max-count=1"],
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  if (!out) throw new Error(`no commit with the subject "${BASELINE_SUBJECT}"`);
  cachedBaseline = out;
  return out;
}

function readSource(file, rev = "working") {
  if (rev === "working") return fs.readFileSync(path.join(ROOT, file), "utf8");
  if (rev === "original") {
    return execFileSync("git", ["show", `${baselineSha()}:${file}`], {
      cwd: ROOT,
      encoding: "utf8",
    });
  }
  throw new Error(`unknown rev ${rev}`);
}

/** The `src` of every <script> in index.html, in document order. */
function scriptsFromIndex(rev = "working") {
  const html = readSource("index.html", rev);
  return [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
}

/*
 * A Storage with the same surface as localStorage. Pass one instance to two
 * loadApp() calls to get two tabs of the same origin.
 *
 *   quota:   setItem throws once the stored strings exceed this many
 *            characters, as it does when the origin's quota is full.
 */
function createStorage({ quota = Infinity } = {}) {
  const map = new Map();
  const storage = {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(k) {
      return map.has(String(k)) ? map.get(String(k)) : null;
    },
    setItem(k, v) {
      const key = String(k);
      const value = String(v);
      let size = key.length + value.length;
      for (const [other, stored] of map) if (other !== key) size += other.length + stored.length;
      if (size > quota) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(key, value);
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
  };
  return storage;
}

/*
 * The browser's own serialisation of a text node, which is what the original
 * escapeHtml relied on (`div.textContent = s; return div.innerHTML`): the
 * HTML spec escapes &, <, > and U+00A0 in text and nothing else. Quotes are
 * left alone. The browser suite confirms this in a real Chrome.
 */
function serialiseText(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
}

function fakeDocument() {
  return {
    createElement() {
      let text = "";
      return {
        set textContent(v) {
          text = v == null ? "" : String(v);
        },
        get textContent() {
          return text;
        },
        get innerHTML() {
          return serialiseText(text);
        },
      };
    },
    getElementById() {
      return null;
    },
  };
}

/*
 * Load the app's scripts into a fresh context.
 *
 *   rev:     "working" or "original"
 *   storage: a createStorage() instance, shared between contexts to model tabs
 *   blocked: make `localStorage` throw on access
 *   exclude: script paths to leave out. app.js is left out by default, since
 *            it reaches for the two panes the moment it runs.
 */
function loadApp({ rev = "working", storage = createStorage(), blocked = false, exclude = ["js/app.js"], now } = {}) {
  const sandbox = {
    console,
    crypto: webcrypto,
    document: fakeDocument(),
    setTimeout,
    clearTimeout,
  };
  /*
   * In a browser that blocks site data, reading `localStorage` itself throws a
   * SecurityError. A throwing getter cannot be modelled on a vm global: the
   * context's interceptor reports it as "localStorage is not defined". So the
   * blocked storage is an object on which every property access throws, which
   * lands the same SecurityError one step later, in the same expression.
   */
  sandbox.localStorage = blocked
    ? new Proxy(
        {},
        {
          get() {
            const err = new Error("The operation is insecure.");
            err.name = "SecurityError";
            throw err;
          },
        }
      )
    : storage;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);

  if (now !== undefined) {
    vm.runInContext(
      `(() => { const Real = Date; const fixed = ${JSON.stringify(now)};
        globalThis.Date = class extends Real {
          constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
          static now() { return new Real(fixed).getTime(); }
        }; })();`,
      context
    );
  }

  const scripts = scriptsFromIndex(rev).filter((s) => !exclude.includes(s));
  for (const file of scripts) {
    vm.runInContext(readSource(file, rev), context, { filename: `${rev}:${file}` });
  }

  return {
    context,
    storage,
    /** Evaluate an expression in the page's global scope. */
    run(expr) {
      return vm.runInContext(expr, context);
    },
    /** Evaluate and hand back a plain copy, so assert.deepStrictEqual can compare across realms. */
    json(expr) {
      const out = vm.runInContext(`JSON.stringify(${expr})`, context);
      return out === undefined ? undefined : JSON.parse(out);
    },
  };
}

/*
 * sw.js in a fake service-worker global: a CacheStorage, a fetch the test
 * answers, and timers the test fires by hand.
 *
 *   network(request) returns a Response, or throws to model being offline,
 *   or returns a promise that never settles to model a network that hangs.
 *
 * Requests are the host's own Request, resolved against BASE the way a
 * worker resolves relative URLs against its script's location. A navigation
 * cannot be constructed as a Request, so navigate() builds a plain object
 * with the same fields.
 */
const BASE = "https://app.test/";

class FakeCache {
  constructor() {
    this.entries = new Map();
  }
  async match(req) {
    const hit = this.entries.get(keyOf(req));
    return hit ? hit.clone() : undefined;
  }
  async put(req, res) {
    this.entries.set(keyOf(req), res.clone());
  }
  async addAll(requests) {
    const fetched = [];
    for (const req of requests) {
      const res = await this.worker.fetchFromNetwork(typeof req === "string" ? new this.worker.Request(req) : req);
      if (!res.ok) throw new TypeError(`addAll: ${res.status} for ${keyOf(req)}`);
      fetched.push([req, res]);
    }
    for (const [req, res] of fetched) await this.put(req, res);
  }
}

function keyOf(req) {
  return new URL(typeof req === "string" ? req : req.url, BASE).href;
}

function loadWorker({ rev = "working", network = () => new Response("", { status: 404 }), caches: initial = {} } = {}) {
  const handlers = {};
  const timers = [];
  const calls = { skipWaiting: 0, claim: 0 };
  const networkLog = [];
  const stores = new Map();

  class WorkerRequest extends Request {
    constructor(input, init) {
      super(typeof input === "string" ? new URL(input, BASE).href : input, init);
    }
  }

  const worker = {
    Request: WorkerRequest,
    fetchFromNetwork(req) {
      networkLog.push(req);
      try {
        return Promise.resolve(network(req));
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };

  const openStore = (name) => {
    if (!stores.has(name)) {
      const cache = new FakeCache();
      cache.worker = worker;
      stores.set(name, cache);
    }
    return stores.get(name);
  };
  for (const [name, entries] of Object.entries(initial)) {
    const cache = openStore(name);
    for (const [url, res] of Object.entries(entries)) cache.entries.set(keyOf(url), res);
  }

  const sandbox = {
    console,
    URL,
    Request: WorkerRequest,
    Response,
    Promise,
    location: new URL("sw.js", BASE),
    setTimeout(fn, ms) {
      timers.push({ fn, ms, fired: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].fired = true;
    },
    fetch: (req) => worker.fetchFromNetwork(req),
    caches: {
      open: async (name) => openStore(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      async match(req) {
        for (const cache of stores.values()) {
          const hit = await cache.match(req);
          if (hit) return hit;
        }
        return undefined;
      },
    },
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    skipWaiting() {
      calls.skipWaiting++;
      return Promise.resolve();
    },
    clients: {
      claim() {
        calls.claim++;
        return Promise.resolve();
      },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(readSource("sw.js", rev), context, { filename: `${rev}:sw.js` });

  /* Dispatch an extendable event; resolves once everything it waited on has. */
  async function lifecycle(type) {
    const waits = [];
    handlers[type]({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }

  /*
   * Dispatch a fetch. `response` is what the page receives: undefined if the
   * worker did not call respondWith (the browser then fetches normally), or
   * the value respondWith's promise settled to -- which the browser turns into
   * a network error unless it is a Response.
   */
  async function dispatchFetch(request) {
    let responded = null;
    const waits = [];
    handlers.fetch({
      request,
      respondWith: (p) => (responded = Promise.resolve(p)),
      waitUntil: (p) => waits.push(p),
    });
    const response = responded ? await responded.catch((e) => ({ rejected: e })) : undefined;
    // Bounded, as the browser bounds it: a test whose network never answers
    // leaves a waitUntil that never settles.
    await Promise.race([Promise.allSettled(waits), new Promise((r) => setTimeout(r, 50))]);
    // The original put into the cache without waitUntil; let that land too.
    await new Promise((r) => setImmediate(r));
    return { handled: responded !== null, response };
  }

  return {
    run: (expr) => vm.runInContext(expr, context),
    lifecycle,
    dispatchFetch,
    stores,
    calls,
    networkLog,
    /* Fire every pending timer, as if its delay had elapsed. */
    fireTimers() {
      for (const t of timers) {
        if (!t.fired) {
          t.fired = true;
          t.fn();
        }
      }
    },
    get: (url) => new WorkerRequest(url),
    navigate: (url) => ({ url: new URL(url, BASE).href, method: "GET", mode: "navigate", headers: new Headers() }),
    cached: (name, url) => stores.get(name) && stores.get(name).entries.get(keyOf(url)),
  };
}

/** The saved projects index, read straight out of storage. */
function savedProjects(storage) {
  return JSON.parse(storage.getItem("assignmentwizard:projects") || "{}");
}

module.exports = {
  ROOT,
  baselineSha,
  readSource,
  scriptsFromIndex,
  createStorage,
  loadApp,
  loadWorker,
  BASE,
  savedProjects,
  serialiseText,
};
