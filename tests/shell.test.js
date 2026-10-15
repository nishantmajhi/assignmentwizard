/*
 * The files the page loads, the files the service worker precaches, and the
 * files on disk have to agree. A script added to index.html and not to
 * APP_SHELL is missing offline; a file in APP_SHELL that does not exist makes
 * install fail, and the worker never takes over at all.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadWorker, scriptsFromIndex, readSource } = require("./harness.js");

const norm = (p) => p.replace(/^\.\//, "");
const APP_SHELL = JSON.parse(loadWorker().run("JSON.stringify(APP_SHELL)")).map(norm);

test("every file in APP_SHELL exists", () => {
  for (const file of APP_SHELL) {
    const target = file === "" ? "index.html" : file;
    assert.ok(fs.existsSync(path.join(ROOT, target)), file);
  }
});

test("every script index.html loads is precached", () => {
  for (const src of scriptsFromIndex()) assert.ok(APP_SHELL.includes(src), src);
});

test("every script in js/ is loaded by index.html", () => {
  const loaded = new Set(scriptsFromIndex());
  const walk = (dir) =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []
    );
  for (const file of walk("js")) assert.ok(loaded.has(file), file);
});

test("app.js is loaded last, after everything it calls", () => {
  const scripts = scriptsFromIndex();
  assert.strictEqual(scripts[scripts.length - 1], "js/app.js");
});

test("the stylesheet, manifest and every local link in index.html are precached", () => {
  const html = readSource("index.html");
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/^https?:/.test(h));
  assert.ok(hrefs.length >= 3);
  for (const href of hrefs) assert.ok(APP_SHELL.includes(href), href);
});

/* A PNG's width and height are the two big-endian words after "IHDR". */
function pngSize(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  assert.strictEqual(bytes.toString("latin1", 12, 16), "IHDR", `${file} is not a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test("every manifest icon exists, is precached, and is the size it claims", () => {
  const manifest = JSON.parse(readSource("manifest.json"));
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  for (const icon of manifest.icons) {
    assert.ok(APP_SHELL.includes(icon.src), icon.src);
    assert.strictEqual(pngSize(icon.src), icon.sizes, icon.src);
  }
});

test("the manifest's start URL is inside its scope and precached", () => {
  const manifest = JSON.parse(readSource("manifest.json"));
  assert.ok(APP_SHELL.includes(norm(manifest.start_url)));
  const base = "https://app.test/app/";
  assert.ok(new URL(manifest.start_url, base).href.startsWith(new URL(manifest.scope, base).href));
});
