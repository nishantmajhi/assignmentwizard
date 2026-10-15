const leftPane = document.getElementById("left-pane");
const rightPane = document.getElementById("right-pane");

const phaseRenderers = [renderSetup, renderExtraction, renderPreferences, renderDrafting];

// UI-only flag (not persisted): forces the "new assessment" setup screen
// even when other saved projects exist, so "Start a new assessment" and
// the picker's "Start a new assessment" button skip straight past the
// picker instead of looping back to it.
let showingNewProjectSetup = false;

/** Called from the project picker and from "start a new assessment" flows.
 *  Deselects whatever project is currently active (it stays saved -- this
 *  isn't a delete) and shows a blank Setup screen. */
function requestNewProjectSetup() {
  showingNewProjectSetup = true;
  state.closeProject();
}

/** Called from the stepper's "Switch assessment" button. Clears the flag
 *  above, which is still set when the button is pressed on a new
 *  assessment's Setup screen, so the picker shows instead of Setup again. */
function requestProjectPicker() {
  showingNewProjectSetup = false;
  state.closeProject();
}

function renderRightPane() {
  const project = state.get();

  if (!project) {
    if (showingNewProjectSetup || state.listProjects().length === 0) {
      renderSetup(rightPane);
    } else {
      renderProjectPicker(rightPane);
    }
    return;
  }

  showingNewProjectSetup = false;
  const render = phaseRenderers[project.currentPhase] || renderSetup;
  render(rightPane);
}

renderStepper(leftPane);
state.subscribe(renderRightPane);
renderRightPane();

if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is a nice-to-have, not required for the app to work */
    });
  });
}
