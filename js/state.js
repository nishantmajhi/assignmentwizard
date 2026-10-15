const PROJECTS_KEY = "assignmentwizard:projects";
const ACTIVE_KEY = "assignmentwizard:activeProjectId";
const LEGACY_KEY = "assignmentwizard:project"; // pre-multi-project storage format

/** localStorage, or an in-memory stand-in when the browser refuses access to
 *  it (it throws a SecurityError when the user has blocked site data). The
 *  app then works for the session and saves nothing. */
function openStorage() {
  try {
    const ls = localStorage;
    ls.getItem(PROJECTS_KEY);
    return ls;
  } catch (e) {
    const values = new Map();
    return {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    };
  }
}

const store = openStorage();

/** A write that fails (a full quota) leaves the in-memory state -- and so the
 *  screen -- correct; it just isn't saved. */
function storeWrite(key, value) {
  try {
    store.setItem(key, value);
  } catch (e) {
    /* nothing useful to do: see above */
  }
}

function storeRemove(key) {
  try {
    store.removeItem(key);
  } catch (e) {
    /* as for storeWrite() */
  }
}

function loadIndex() {
  const raw = store.getItem(PROJECTS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** One-time migration from the old single-project storage key, so anyone
 *  with existing data doesn't lose their project when this ships. */
function migrateLegacyProject(index) {
  const raw = store.getItem(LEGACY_KEY);
  if (!raw) return index;
  try {
    const legacy = JSON.parse(raw);
    if (legacy && legacy.projectId) {
      index[legacy.projectId] = legacy;
      storeWrite(PROJECTS_KEY, JSON.stringify(index));
      if (!store.getItem(ACTIVE_KEY)) {
        storeWrite(ACTIVE_KEY, legacy.projectId);
      }
    }
  } catch (e) {
    /* malformed legacy data isn't worth keeping around */
  }
  storeRemove(LEGACY_KEY);
  return index;
}

function createProject(name) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  return {
    projectId: id,
    projectName: name,
    currentPhase: 0,
    highestPhaseReached: 0,
    phase2_preferences: {
      wordCountMode: "fixed",
      wordCountValue: "",
      formattingMode: "ms_default",
      customFormatting: "",
      referencingStyleChoice: "",
      referencingStyleOther: ""
    },
    // Hand-edited prompt text, kept separate from the auto-generated prompt
    // so edits survive navigating away and back. null/undefined means
    // "nothing typed yet -- show the freshly generated prompt".
    phase1_extractionPromptOverride: null,
    phase3_promptMode: "basic",
    phase3_draftingPromptOverrideBasic: null,
    phase3_draftingPromptOverrideAdvanced: null,
    updatedAt: new Date().toISOString()
  };
}

const initialIndex = migrateLegacyProject(loadIndex());
let activeId = store.getItem(ACTIVE_KEY) || null;
let project = (activeId && initialIndex[activeId]) ? initialIndex[activeId] : null;
if (activeId && !project) {
  // Stale pointer (e.g. the active project was deleted in another tab).
  activeId = null;
  storeRemove(ACTIVE_KEY);
}

const listeners = new Set();

/** Every saved project as storage holds it now, with the one open here laid
 *  over it. Read fresh each time rather than kept from page load: another tab
 *  of the app writes the same key, and writing back a copy taken at load
 *  would delete whatever that tab had saved since. */
function currentIndex() {
  const index = loadIndex();
  if (project) index[project.projectId] = project;
  return index;
}

function persistIndex(index) {
  storeWrite(PROJECTS_KEY, JSON.stringify(index));
}

function persistActive() {
  if (activeId) {
    storeWrite(ACTIVE_KEY, activeId);
  } else {
    storeRemove(ACTIVE_KEY);
  }
}

function persist() {
  if (project) project.updatedAt = new Date().toISOString();
  persistIndex(currentIndex());
  persistActive();
}

/** Whether applying patch would change anything in the open project. */
function patchChangesProject(patch) {
  return Object.keys(patch).some(
    (key) => JSON.stringify(project[key]) !== JSON.stringify(patch[key])
  );
}

function notify() {
  listeners.forEach((fn) => fn(project));
}

/** Phases at/after phaseIndex stop counting as "done" -- the stepper will
 *  no longer treat them as complete and the user has to step through them
 *  again. Their answers (preferences, etc.) are left in place; this only
 *  affects progress tracking. */
function invalidateFrom(phaseIndex) {
  if (!project) return;
  if (project.highestPhaseReached > phaseIndex) {
    project.highestPhaseReached = phaseIndex;
  }
  if (project.currentPhase > phaseIndex) {
    project.currentPhase = phaseIndex;
  }
  // A hand-edited prompt is only valid for the inputs it was built from --
  // if something upstream (project name, preferences) changes, drop the
  // saved edit so the phase falls back to a freshly generated prompt
  // instead of silently showing stale, edited text.
  if (phaseIndex <= 1) {
    project.phase1_extractionPromptOverride = null;
  }
  if (phaseIndex <= 3) {
    project.phase3_draftingPromptOverrideBasic = null;
    project.phase3_draftingPromptOverrideAdvanced = null;
  }
}

const state = {
  get() {
    return project;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Summaries of every saved project, most recently updated first. */
  listProjects() {
    return Object.values(currentIndex()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  },

  startProject(name) {
    project = createProject(name);
    activeId = project.projectId;
    persist();
    notify();
  },

  openProject(id) {
    const found = currentIndex()[id];
    if (!found) return;
    project = found;
    activeId = id;
    persist();
    notify();
  },

  /** Deselect the active project without deleting it, so the picker shows. */
  closeProject() {
    project = null;
    activeId = null;
    persistActive();
    notify();
  },

  deleteProject(id) {
    const index = loadIndex();
    delete index[id];
    persistIndex(index);
    if (activeId === id) {
      project = null;
      activeId = null;
      persistActive();
    }
    notify();
  },

  goToPhase(index) {
    if (!project) return;
    project.currentPhase = index;
    if (index > project.highestPhaseReached) project.highestPhaseReached = index;
    persist();
    notify();
  },

  /** Rename the active project. The extraction/drafting prompts are keyed
   *  off the project name, so renaming after later phases were already
   *  reached invalidates them -- the user re-confirms on the way through. */
  renameProject(name) {
    if (!project) return;
    if (project.projectName !== name) {
      project.projectName = name;
      invalidateFrom(0);
    }
    persist();
    notify();
  },

  /** Structural update that re-renders the UI (use for toggles, selections). */
  update(patch) {
    if (!project) return;
    Object.assign(project, patch);
    persist();
    notify();
  },

  /** Silent update that saves without re-rendering (use for free-text typing). */
  patch(patch) {
    if (!project) return;
    Object.assign(project, patch);
    persist();
  },

  /** Same as update(), but also invalidates any phases at/after phaseIndex
   *  that had already been marked complete -- use when a field that an
   *  earlier, already-passed phase depends on changes underneath it. A patch
   *  that leaves every value as it was invalidates nothing. */
  updateAndInvalidate(patch, phaseIndex) {
    if (!project) return;
    const changed = patchChangesProject(patch);
    Object.assign(project, patch);
    if (changed) invalidateFrom(phaseIndex);
    persist();
    notify();
  },

  /** Same as patch(), but also invalidates without forcing a re-render
   *  (use for free-text fields, where re-rendering would lose focus). */
  patchAndInvalidate(patch, phaseIndex) {
    if (!project) return;
    const changed = patchChangesProject(patch);
    Object.assign(project, patch);
    if (changed) invalidateFrom(phaseIndex);
    persist();
  },

  /** Delete the active project entirely and return to no active project. */
  reset() {
    if (project) {
      const index = loadIndex();
      delete index[project.projectId];
      persistIndex(index);
    }
    project = null;
    activeId = null;
    persistActive();
    notify();
  }
};
