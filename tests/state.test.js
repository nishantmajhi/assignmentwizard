/*
 * js/state.js: the saved projects, the active-project pointer, and the rules
 * for when an edit upstream sends later phases back to "not reached".
 *
 * Two tabs of the app are two loadApp() calls sharing one storage, which is
 * exactly what two tabs of the same origin share.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, createStorage, savedProjects } = require("./harness.js");

const REVS = ["original", "working"];

/** A project advanced to the drafting step with a hand-edited prompt. */
function projectAtDrafting(app, name = "Essay") {
  app.run(`state.startProject(${JSON.stringify(name)})`);
  app.run("state.goToPhase(1)");
  app.run("state.goToPhase(2)");
  app.run("state.goToPhase(3)");
  app.run(`state.patch({ phase3_draftingPromptOverrideBasic: "my edited prompt" })`);
}

/* ------------------------------------------------------------------ *
 * What the original got wrong
 * ------------------------------------------------------------------ */

test("regression: a project saved in another tab survives this tab's next save", () => {
  const outcome = {};
  for (const rev of REVS) {
    const storage = createStorage();
    const tabA = loadApp({ rev, storage });
    const tabB = loadApp({ rev, storage });

    tabB.run(`state.startProject("Started in tab B")`);
    tabA.run(`state.startProject("Started in tab A")`);

    outcome[rev] = Object.values(savedProjects(storage)).map((p) => p.projectName).sort();
  }
  // The original held the whole index in memory from page load and wrote all
  // of it back on every save, so tab A's first keystroke deleted tab B's work.
  assert.deepStrictEqual(outcome.original, ["Started in tab A"]);
  assert.deepStrictEqual(outcome.working, ["Started in tab A", "Started in tab B"]);
});

test("regression: typing in one tab does not delete a project another tab created", () => {
  const outcome = {};
  for (const rev of REVS) {
    const storage = createStorage();
    const tabA = loadApp({ rev, storage });
    tabA.run(`state.startProject("Mine")`);
    const tabB = loadApp({ rev, storage });
    tabB.run(`state.startProject("Other")`);

    tabA.run(`state.patch({ phase1_extractionPromptOverride: "typed" })`);

    outcome[rev] = Object.values(savedProjects(storage)).map((p) => p.projectName).sort();
  }
  assert.deepStrictEqual(outcome.original, ["Mine"]);
  assert.deepStrictEqual(outcome.working, ["Mine", "Other"]);
});

test("regression: opening a project reads the saved copy, not the one this tab loaded", () => {
  const outcome = {};
  for (const rev of REVS) {
    const storage = createStorage();
    const setup = loadApp({ rev, storage });
    setup.run(`state.startProject("Essay")`);
    const id = setup.run("state.get().projectId");
    setup.run("state.closeProject()");

    const stale = loadApp({ rev, storage }); // opened before the edit below
    const editor = loadApp({ rev, storage });
    editor.run(`state.openProject(${JSON.stringify(id)})`);
    editor.run(`state.renameProject("Essay, renamed in the other tab")`);
    editor.run("state.closeProject()");

    stale.run(`state.openProject(${JSON.stringify(id)})`);
    outcome[rev] = {
      shown: stale.run("state.get().projectName"),
      saved: savedProjects(storage)[id].projectName,
    };
  }
  // The original opened its own copy from page load and saved it straight back
  // over the newer one.
  assert.deepStrictEqual(outcome.original, { shown: "Essay", saved: "Essay" });
  assert.deepStrictEqual(outcome.working, {
    shown: "Essay, renamed in the other tab",
    saved: "Essay, renamed in the other tab",
  });
});

test("regression: the app still loads when the browser blocks site data", () => {
  // Chrome and Firefox throw a SecurityError from the `localStorage` getter
  // itself when the user has blocked cookies and site data.
  assert.throws(() => loadApp({ rev: "original", blocked: true }), { name: "SecurityError" });

  const app = loadApp({ rev: "working", blocked: true });
  assert.strictEqual(app.run("state.get()"), null);
  app.run(`state.startProject("Unsaved but usable")`);
  app.run("state.goToPhase(1)");
  assert.strictEqual(app.run("state.get().projectName"), "Unsaved but usable");
  assert.strictEqual(app.run("state.get().currentPhase"), 1);
  assert.strictEqual(app.run("state.listProjects().length"), 1);
});

test("regression: a full storage quota does not stop the screen updating", () => {
  const outcome = {};
  for (const rev of REVS) {
    const app = loadApp({ rev, storage: createStorage({ quota: 4000 }) });
    app.run(`state.startProject("Essay")`);
    app.run("var renders = 0; state.subscribe(() => renders++)");

    let threw = null;
    try {
      app.run(`state.update({ phase3_promptMode: "advanced", padding: "x".repeat(5000) })`);
    } catch (e) {
      threw = e.name;
    }
    outcome[rev] = {
      threw,
      renders: app.run("renders"),
      mode: app.run("state.get().phase3_promptMode"),
    };
  }
  // The original threw out of update() before notify(), so the toggle the user
  // pressed changed state and never redrew.
  assert.deepStrictEqual(outcome.original, { threw: "QuotaExceededError", renders: 0, mode: "advanced" });
  assert.deepStrictEqual(outcome.working, { threw: null, renders: 1, mode: "advanced" });
});

test("regression: choosing the preference that is already selected keeps the edited drafting prompt", () => {
  const outcome = {};
  for (const rev of REVS) {
    const app = loadApp({ rev });
    projectAtDrafting(app);
    app.run("state.goToPhase(2)");

    // What the "Fixed word count" button does when it is already selected.
    app.run(`state.updateAndInvalidate({ phase2_preferences: { ...state.get().phase2_preferences, wordCountMode: "fixed" } }, 2)`);

    outcome[rev] = app.json(
      "{ highest: state.get().highestPhaseReached, edit: state.get().phase3_draftingPromptOverrideBasic }"
    );
  }
  assert.deepStrictEqual(outcome.original, { highest: 2, edit: null });
  assert.deepStrictEqual(outcome.working, { highest: 3, edit: "my edited prompt" });
});

/* ------------------------------------------------------------------ *
 * Behaviour both versions share, kept so a fix cannot break it
 * ------------------------------------------------------------------ */

test("a new project starts at Setup with the documented defaults", () => {
  const app = loadApp();
  app.run(`state.startProject("Marketing Ethics Essay")`);
  const p = app.json("state.get()");
  assert.strictEqual(p.projectName, "Marketing Ethics Essay");
  assert.strictEqual(p.currentPhase, 0);
  assert.strictEqual(p.highestPhaseReached, 0);
  assert.deepStrictEqual(p.phase2_preferences, {
    wordCountMode: "fixed",
    wordCountValue: "",
    formattingMode: "ms_default",
    customFormatting: "",
    referencingStyleChoice: "",
    referencingStyleOther: "",
  });
  assert.strictEqual(p.phase3_promptMode, "basic");
  assert.match(p.projectId, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(p.updatedAt)));
});

test("the active project is saved and restored on the next load", () => {
  const storage = createStorage();
  const first = loadApp({ storage });
  first.run(`state.startProject("Essay")`);
  first.run("state.goToPhase(2)");
  const id = first.run("state.get().projectId");

  const reloaded = loadApp({ storage });
  assert.strictEqual(reloaded.run("state.get().projectId"), id);
  assert.strictEqual(reloaded.run("state.get().currentPhase"), 2);
  assert.strictEqual(storage.getItem("assignmentwizard:activeProjectId"), id);
});

test("goToPhase records the furthest phase reached and never lowers it", () => {
  const app = loadApp();
  app.run(`state.startProject("Essay")`);
  app.run("state.goToPhase(3)");
  app.run("state.goToPhase(1)");
  assert.deepStrictEqual(app.json("[state.get().currentPhase, state.get().highestPhaseReached]"), [1, 3]);
});

test("renaming to the same name changes nothing", () => {
  const app = loadApp();
  projectAtDrafting(app);
  app.run("state.goToPhase(0)");
  app.run(`state.renameProject("Essay")`);
  assert.strictEqual(app.run("state.get().highestPhaseReached"), 3);
  assert.strictEqual(app.run("state.get().phase3_draftingPromptOverrideBasic"), "my edited prompt");
});

test("renaming sends every later phase back and drops both hand-edited prompts", () => {
  const app = loadApp();
  projectAtDrafting(app);
  app.run(`state.patch({ phase1_extractionPromptOverride: "edited extraction" })`);
  app.run("state.goToPhase(0)");
  app.run(`state.renameProject("A different essay")`);
  const p = app.json("state.get()");
  assert.strictEqual(p.highestPhaseReached, 0);
  assert.strictEqual(p.currentPhase, 0);
  assert.strictEqual(p.phase1_extractionPromptOverride, null);
  assert.strictEqual(p.phase3_draftingPromptOverrideBasic, null);
  assert.strictEqual(p.phase3_draftingPromptOverrideAdvanced, null);
});

test("changing a preference sends Draft back but keeps the edited extraction prompt", () => {
  const app = loadApp();
  projectAtDrafting(app);
  app.run(`state.patch({ phase1_extractionPromptOverride: "edited extraction" })`);
  app.run("state.goToPhase(2)");
  app.run(`state.updateAndInvalidate({ phase2_preferences: { ...state.get().phase2_preferences, wordCountMode: "free" } }, 2)`);
  const p = app.json("state.get()");
  assert.strictEqual(p.highestPhaseReached, 2);
  assert.strictEqual(p.phase2_preferences.wordCountMode, "free");
  assert.strictEqual(p.phase1_extractionPromptOverride, "edited extraction");
  assert.strictEqual(p.phase3_draftingPromptOverrideBasic, null);
});

test("typing a preference sends Draft back without re-rendering", () => {
  const app = loadApp();
  projectAtDrafting(app);
  app.run("state.goToPhase(2)");
  app.run("var renders = 0; state.subscribe(() => renders++)");
  app.run(`state.patchAndInvalidate({ phase2_preferences: { ...state.get().phase2_preferences, wordCountValue: "1500" } }, 2)`);
  assert.strictEqual(app.run("renders"), 0);
  assert.strictEqual(app.run("state.get().highestPhaseReached"), 2);
  assert.strictEqual(app.run("state.get().phase3_draftingPromptOverrideBasic"), null);
});

test("update notifies and patch does not", () => {
  const app = loadApp();
  app.run(`state.startProject("Essay")`);
  app.run("var renders = 0; state.subscribe(() => renders++)");
  app.run(`state.patch({ phase3_promptMode: "advanced" })`);
  assert.strictEqual(app.run("renders"), 0);
  app.run(`state.update({ phase3_promptMode: "basic" })`);
  assert.strictEqual(app.run("renders"), 1);
});

test("closeProject deselects without deleting", () => {
  const storage = createStorage();
  const app = loadApp({ storage });
  app.run(`state.startProject("Essay")`);
  app.run("state.closeProject()");
  assert.strictEqual(app.run("state.get()"), null);
  assert.strictEqual(storage.getItem("assignmentwizard:activeProjectId"), null);
  assert.strictEqual(Object.keys(savedProjects(storage)).length, 1);
});

test("deleteProject removes it, and deselects it if it was open", () => {
  const storage = createStorage();
  const app = loadApp({ storage });
  app.run(`state.startProject("Keep")`);
  const keep = app.run("state.get().projectId");
  app.run(`state.startProject("Delete")`);
  const gone = app.run("state.get().projectId");

  app.run(`state.deleteProject(${JSON.stringify(gone)})`);
  assert.strictEqual(app.run("state.get()"), null);
  assert.deepStrictEqual(Object.keys(savedProjects(storage)), [keep]);

  app.run(`state.openProject(${JSON.stringify(keep)})`);
  app.run(`state.deleteProject("no-such-id")`);
  assert.strictEqual(app.run("state.get().projectId"), keep);
});

test("reset deletes the active project", () => {
  const storage = createStorage();
  const app = loadApp({ storage });
  app.run(`state.startProject("Essay")`);
  app.run("state.reset()");
  assert.strictEqual(app.run("state.get()"), null);
  assert.deepStrictEqual(savedProjects(storage), {});
});

test("openProject ignores an id that is not saved", () => {
  const app = loadApp();
  app.run(`state.startProject("Essay")`);
  const id = app.run("state.get().projectId");
  app.run(`state.openProject("missing")`);
  assert.strictEqual(app.run("state.get().projectId"), id);
});

test("listProjects puts the most recently updated first", () => {
  const storage = createStorage();
  storage.setItem(
    "assignmentwizard:projects",
    JSON.stringify({
      a: { projectId: "a", projectName: "Oldest", updatedAt: "2026-01-01T00:00:00.000Z" },
      b: { projectId: "b", projectName: "Newest", updatedAt: "2026-03-01T00:00:00.000Z" },
      c: { projectId: "c", projectName: "Middle", updatedAt: "2026-02-01T00:00:00.000Z" },
    })
  );
  const app = loadApp({ storage });
  assert.deepStrictEqual(app.json("state.listProjects().map((p) => p.projectName)"), ["Newest", "Middle", "Oldest"]);
});

test("listProjects includes a project another tab saved after this one loaded", () => {
  const storage = createStorage();
  const tabA = loadApp({ storage });
  const tabB = loadApp({ storage });
  tabB.run(`state.startProject("From tab B")`);
  assert.deepStrictEqual(tabA.json("state.listProjects().map((p) => p.projectName)"), ["From tab B"]);
});

test("a project deleted in another tab while open here is saved again by the next edit here", () => {
  // Deliberate: the tab where someone is typing wins. The alternative is to
  // discard what they are typing without telling them.
  const storage = createStorage();
  const editing = loadApp({ storage });
  editing.run(`state.startProject("Essay")`);
  const id = editing.run("state.get().projectId");
  const other = loadApp({ storage });
  other.run(`state.deleteProject(${JSON.stringify(id)})`);
  assert.deepStrictEqual(savedProjects(storage), {});

  editing.run(`state.patch({ phase1_extractionPromptOverride: "still typing" })`);
  assert.strictEqual(savedProjects(storage)[id].phase1_extractionPromptOverride, "still typing");
});

test("a pointer to a project that no longer exists is cleared on load", () => {
  const storage = createStorage();
  storage.setItem("assignmentwizard:activeProjectId", "gone");
  const app = loadApp({ storage });
  assert.strictEqual(app.run("state.get()"), null);
  assert.strictEqual(storage.getItem("assignmentwizard:activeProjectId"), null);
});

test("unreadable saved data starts empty rather than failing to load", () => {
  for (const raw of ["{not json", "null", "42"]) {
    const storage = createStorage();
    storage.setItem("assignmentwizard:projects", raw);
    const app = loadApp({ storage });
    assert.strictEqual(app.run("state.listProjects().length"), 0, raw);
  }
});

test("the single-project format from before multiple projects is migrated once", () => {
  const storage = createStorage();
  const legacy = {
    projectId: "legacy-1",
    projectName: "Old essay",
    currentPhase: 2,
    highestPhaseReached: 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  storage.setItem("assignmentwizard:project", JSON.stringify(legacy));
  const app = loadApp({ storage });
  assert.strictEqual(storage.getItem("assignmentwizard:project"), null);
  assert.strictEqual(savedProjects(storage)["legacy-1"].projectName, "Old essay");
  assert.strictEqual(app.run("state.get().projectId"), "legacy-1");
});

test("migration leaves an existing active pointer alone and discards malformed legacy data", () => {
  const storage = createStorage();
  storage.setItem(
    "assignmentwizard:projects",
    JSON.stringify({ now: { projectId: "now", projectName: "Current", updatedAt: "2026-02-01T00:00:00.000Z" } })
  );
  storage.setItem("assignmentwizard:activeProjectId", "now");
  storage.setItem("assignmentwizard:project", JSON.stringify({ projectId: "old", projectName: "Old" }));
  const app = loadApp({ storage });
  assert.strictEqual(app.run("state.get().projectId"), "now");
  assert.deepStrictEqual(Object.keys(savedProjects(storage)).sort(), ["now", "old"]);

  const broken = createStorage();
  broken.setItem("assignmentwizard:project", "{broken");
  loadApp({ storage: broken });
  assert.strictEqual(broken.getItem("assignmentwizard:project"), null);
  assert.deepStrictEqual(savedProjects(broken), {});
});
