/*
 * js/prompts.js: the text the app exists to produce. Nothing here was wrong;
 * these pin what the prompts say so a change to them is a decision.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./harness.js");

const app = loadApp();
const prefs = (over = {}) => ({
  wordCountMode: "fixed",
  wordCountValue: "",
  formattingMode: "ms_default",
  customFormatting: "",
  referencingStyleChoice: "",
  referencingStyleOther: "",
  ...over,
});
const call = (fn, ...args) => app.run(`${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`);

test("the extraction prompt names the project and asks for all six things", () => {
  const text = call("buildExtractionPrompt", "Marketing Ethics Essay");
  assert.ok(text.includes('assignment file for "Marketing Ethics Essay"'));
  for (let n = 1; n <= 6; n++) assert.match(text, new RegExp(`^${n}\\. `, "m"));
  assert.match(text, /say so explicitly rather than guessing/);
});

test("a fixed word count becomes a range from 90% of the target up to it", () => {
  assert.match(call("buildWordCountLine", prefs({ wordCountValue: "1500" })), /strictly between 1350 and 1500 words/);
  assert.match(call("buildWordCountLine", prefs({ wordCountValue: "2000" })), /strictly between 1800 and 2000 words/);
  assert.match(call("buildWordCountLine", prefs({ wordCountValue: 750 })), /strictly between 675 and 750 words/);
});

test("a blank, zero, negative or unreadable word count falls back to 900 to 1000", () => {
  for (const value of ["", "0", "-50", "abc", undefined]) {
    assert.match(call("buildWordCountLine", prefs({ wordCountValue: value })), /strictly between 900 and 1000 words/, String(value));
  }
});

test("free writing asks for no word count", () => {
  const line = call("buildWordCountLine", prefs({ wordCountMode: "free", wordCountValue: "1500" }));
  assert.match(line, /^No strict word count/);
  assert.doesNotMatch(line, /1500/);
});

test("Microsoft Office default formatting is one bullet naming Aptos", () => {
  const bullets = app.json(`buildFormattingBullets(${JSON.stringify(prefs())})`);
  assert.strictEqual(bullets.length, 1);
  assert.match(bullets[0], /Aptos/);
});

test("custom formatting passes the typed rules through", () => {
  const bullets = app.json(`buildFormattingBullets(${JSON.stringify(prefs({ formattingMode: "custom", customFormatting: "Arial 11pt, double spaced" }))})`);
  assert.strictEqual(bullets.length, 1);
  assert.ok(bullets[0].endsWith(": Arial 11pt, double spaced"));
});

test("custom formatting left blank falls back to the built-in style guide's three rules", () => {
  const bullets = app.json(`buildFormattingBullets(${JSON.stringify(prefs({ formattingMode: "custom" }))})`);
  assert.deepStrictEqual(bullets, app.json("MIDACKER_DEFAULT_FORMATTING_BULLETS"));
  assert.strictEqual(bullets.length, 3);
  assert.match(bullets.join("\n"), /Times New Roman/);
  assert.match(bullets.join("\n"), /20pt for the Title/);
  assert.match(bullets.join("\n"), /1\.5 line spacing/);
  // A copy, so a caller cannot edit the defaults.
  app.run(`buildFormattingBullets(${JSON.stringify(prefs({ formattingMode: "custom" }))}).push("x")`);
  assert.strictEqual(app.run("MIDACKER_DEFAULT_FORMATTING_BULLETS.length"), 3);
});

test("custom formatting saved by an older version is still read", () => {
  const legacy = { wordCountMode: "fixed", formattingMode: "custom", font: "Georgia", fontSize: "12pt" };
  const bullets = app.json(`buildFormattingBullets(${JSON.stringify(legacy)})`);
  assert.ok(bullets[0].endsWith(": Georgia, 12pt"));
});

test("the referencing style reaches both the citation rule and the guide", () => {
  const withStyle = call("buildDraftingPrompt", "Essay", prefs({ referencingStyleChoice: "Harvard" }));
  assert.match(withStyle, /I will add Harvard citations myself/);
  assert.match(withStyle, /find and format Harvard citations/);

  const other = call("buildDraftingPrompt", "Essay", prefs({ referencingStyleChoice: "Other", referencingStyleOther: "AGLC4" }));
  assert.match(other, /I will add AGLC4 citations myself/);

  const none = call("buildDraftingPrompt", "Essay", prefs());
  assert.match(none, /\(I will add them myself\)/);
  assert.match(none, /whatever style the assessment specifies/);
});

test("the basic drafting prompt asks for a docx, with the shared formatting section", () => {
  const p = prefs({ wordCountValue: "1200", referencingStyleChoice: "IEEE" });
  const text = call("buildDraftingPrompt", "Lab Report", p);
  assert.ok(text.startsWith('Please write a complete docx file based on the uploaded assessment for "Lab Report".'));
  assert.match(text, /- Word count strictly between 1080 and 1200 words/);
  assert.match(text, /- Use a minus sign instead of an em dash or en dash/);
  const formatting = app.json(`buildSharedFormattingBullets(${JSON.stringify(p)})`).map((l) => `- ${l}`).join("\n");
  assert.ok(text.endsWith(`Formatting:\n${formatting}`));
});

test("the advanced prompt asks for a Kiln script and keeps the same requirements", () => {
  const p = prefs({ wordCountValue: "1200", formattingMode: "custom", customFormatting: "Calibri 11" });
  const basic = call("buildDraftingPrompt", "Lab Report", p);
  const advanced = call("buildAdvancedDraftingPrompt", "Lab Report", p);
  assert.match(advanced, /^Please write the Node\.js script/);
  assert.match(advanced, /Kiln's vm sandbox/);
  assert.match(advanced, /first line of the script must be a comment/);
  const section = (t) => t.slice(t.indexOf("Formatting:"));
  assert.strictEqual(section(advanced), section(basic));
  for (const line of basic.split("\n").filter((l) => l.startsWith("- Word count") || l.startsWith("- Use a minus"))) {
    assert.ok(advanced.includes(line), line);
  }
});
