const PHASES = [
  { title: "Setup", subtitle: "Name your project" },
  { title: "Extract", subtitle: "Understand the brief" },
  { title: "Preferences", subtitle: "Set your constraints" },
  { title: "Draft", subtitle: "Generate your prompt" }
];

function renderStepper(container) {
  function draw() {
    const project = state.get();
    const current = project ? project.currentPhase : -1;
    const highest = project ? project.highestPhaseReached : -1;
    const hasSavedProjects = state.listProjects().length > 0;

    container.innerHTML = `
      <div class="stepper">
        <div class="stepper-brand">
          <span class="stepper-brand-mark" aria-hidden="true"></span>
          <span class="stepper-brand-name">AssignmentWizard</span>
        </div>
        ${hasSavedProjects ? `<button type="button" id="switch-project-btn" class="stepper-switch-btn">&larr; Switch assessment</button>` : ""}
        <ol class="stepper-list">
          ${PHASES.map((phase, i) => {
            const cls = i === current ? "is-active" : i <= highest ? "is-done" : "is-upcoming";
            const clickable = project && i <= highest && i !== current;
            const dotContent = i < current ? "&check;" : String(i + 1);
            return `
              <li class="stepper-item ${cls}" data-index="${i}" ${clickable ? 'role="button" tabindex="0"' : ""}>
                <span class="stepper-dot">${dotContent}</span>
                <span class="stepper-text">
                  <span class="stepper-title">${phase.title}</span>
                  <span class="stepper-subtitle">${phase.subtitle}</span>
                </span>
              </li>`;
          }).join("")}
        </ol>
      </div>
    `;

    const switchBtn = container.querySelector("#switch-project-btn");
    if (switchBtn) switchBtn.addEventListener("click", requestProjectPicker);

    container.querySelectorAll('.stepper-item[role="button"]').forEach((el) => {
      const go = () => state.goToPhase(Number(el.dataset.index));
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  state.subscribe(draw);
  draw();
}
