/*
 * js/utils.js: escaping, and reading preferences saved in older formats.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./harness.js");

const escape = (app, s) => app.run(`escapeHtml(${JSON.stringify(s)})`);

test("regression: escapeHtml makes a value safe inside a double-quoted attribute", () => {
  // The Setup screen writes the project name into value="...". The original
  // escaped through a text node, which escapes &, < and > and leaves quotes
  // alone, so a name with a quote in it ended the attribute early. The
  // browser suite shows what that did on screen.
  const name = 'Essay on "1984"';
  assert.strictEqual(escape(loadApp({ rev: "original" }), name), 'Essay on "1984"');
  assert.strictEqual(escape(loadApp(), name), "Essay on &quot;1984&quot;");
});

test("escapeHtml escapes every character that is special in text or an attribute", () => {
  const app = loadApp();
  assert.strictEqual(escape(app, `<b class='x'>"A" & B</b>`), "&lt;b class=&#39;x&#39;&gt;&quot;A&quot; &amp; B&lt;/b&gt;");
  assert.strictEqual(escape(app, "plain text"), "plain text");
  assert.strictEqual(escape(app, "&amp;"), "&amp;amp;");
});

test("escapeHtml treats null and undefined as empty, and stringifies numbers", () => {
  const app = loadApp();
  assert.strictEqual(app.run("escapeHtml(null)"), "");
  assert.strictEqual(app.run("escapeHtml(undefined)"), "");
  assert.strictEqual(app.run("escapeHtml(1500)"), "1500");
});

test("escapeHtml agrees with the original wherever the original was right", () => {
  const original = loadApp({ rev: "original" });
  const working = loadApp();
  for (const s of ["", "abc", "a < b > c", "fish & chips", "tab\tand\nnewline", "नेपाली", "emoji 🙂"]) {
    assert.strictEqual(escape(working, s), escape(original, s), JSON.stringify(s));
  }
});

test("resolveReferencingStyle reads the dropdown, and Other's free text", () => {
  const app = loadApp();
  const resolve = (prefs) => app.run(`resolveReferencingStyle(${JSON.stringify(prefs)})`);
  assert.strictEqual(resolve({ referencingStyleChoice: "Harvard", referencingStyleOther: "ignored" }), "Harvard");
  assert.strictEqual(resolve({ referencingStyleChoice: "Other", referencingStyleOther: "AGLC4" }), "AGLC4");
  assert.strictEqual(resolve({ referencingStyleChoice: "Other" }), "");
  assert.strictEqual(resolve({ referencingStyleChoice: "" }), "");
});

test("resolveReferencingStyle reads the single free-text field older projects saved", () => {
  const app = loadApp();
  const resolve = (prefs) => app.run(`resolveReferencingStyle(${JSON.stringify(prefs)})`);
  assert.strictEqual(resolve({ referencingStyle: "APA 7th edition" }), "APA 7th edition");
  assert.strictEqual(resolve({}), "");
});

test("resolveCustomFormatting reads the one field, or the font fields older projects saved", () => {
  const app = loadApp();
  const resolve = (prefs) => app.run(`resolveCustomFormatting(${JSON.stringify(prefs)})`);
  assert.strictEqual(resolve({ customFormatting: "Arial 11pt, double spaced" }), "Arial 11pt, double spaced");
  assert.strictEqual(resolve({ customFormatting: "" }), "");
  assert.strictEqual(resolve({ font: "Arial", fontSize: "11pt" }), "Arial, 11pt");
  assert.strictEqual(resolve({ font: "Arial" }), "Arial");
  assert.strictEqual(resolve({}), "");
});

test("the referencing list has no duplicates and does not list Other", () => {
  const styles = loadApp().json("REFERENCING_STYLES");
  assert.strictEqual(new Set(styles).size, styles.length);
  assert.ok(!styles.includes("Other"));
  assert.ok(styles.length > 0);
});
