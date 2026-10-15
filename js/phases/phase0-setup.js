function renderSetup(container) {
  const project = state.get();

  container.innerHTML = `
    <div class="phase-card">
      <p class="phase-eyebrow">Step 1 of 4</p>
      <h1>What are you working on?</h1>
      <p class="phase-lede">Give this assessment a name. You'll be guided through understanding the brief, setting your constraints, and generating a drafting prompt.</p>
      <label class="field-label" for="project-name">Project name</label>
      <input
        id="project-name"
        class="text-input"
        type="text"
        placeholder="e.g. Marketing Ethics Essay"
        value="${project ? escapeHtml(project.projectName) : ""}"
        autocomplete="off"
      />
      <button id="start-btn" class="btn-primary">${project ? "Save" : "Start"} <span aria-hidden="true">&rarr;</span></button>
    </div>
  `;

  const input = container.querySelector("#project-name");
  const button = container.querySelector("#start-btn");
  input.focus();

  function start() {
    const name = input.value.trim();
    if (!name) {
      input.classList.add("has-error");
      input.focus();
      return;
    }
    if (project) {
      // Editing an existing project's name. If it changed, this invalidates
      // any later phases already reached (see state.renameProject), so the
      // user re-confirms them on the way back through.
      state.renameProject(name);
    } else {
      state.startProject(name);
    }
    state.goToPhase(1);
  }

  button.addEventListener("click", start);
  input.addEventListener("input", () => input.classList.remove("has-error"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start();
  });
}
