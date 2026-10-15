/** Shown when there's no active project but at least one saved one exists.
 *  Lets the user resume a saved assessment, delete one, or start a new one.
 *  Relies on PHASES from stepper.js and escapeHtml from utils.js, loaded
 *  earlier on the page (classic scripts share one global scope). */
function renderProjectPicker(container) {
  const projects = state.listProjects();

  container.innerHTML = `
    <div class="phase-card">
      <p class="phase-eyebrow">Your assessments</p>
      <h1>Pick up where you left off</h1>
      <p class="phase-lede">Open a saved assessment to continue, or start a new one.</p>
      <ul class="project-list">
        ${projects.map((p) => `
          <li class="project-list-item">
            <button type="button" class="project-open-btn" data-id="${escapeHtml(p.projectId)}">
              <span class="project-list-name">${escapeHtml(p.projectName)}</span>
              <span class="project-list-meta">${escapeHtml(phaseLabel(p))} &middot; updated ${escapeHtml(formatRelativeDate(p.updatedAt))}</span>
            </button>
            <button type="button" class="project-delete-btn" data-id="${escapeHtml(p.projectId)}" aria-label="Delete ${escapeHtml(p.projectName)}" title="Delete this assessment">&times;</button>
          </li>
        `).join("")}
      </ul>
      <button id="new-project-btn" class="btn-primary">Start a new assessment <span aria-hidden="true">&rarr;</span></button>
    </div>
  `;

  container.querySelectorAll(".project-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => state.openProject(btn.dataset.id));
  });

  container.querySelectorAll(".project-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const proj = projects.find((p) => p.projectId === btn.dataset.id);
      const label = proj ? proj.projectName : "this assessment";
      const confirmed = await confirmDialog({
        title: "Delete this assessment?",
        message: `"${label}" will be permanently deleted. This can't be undone.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true
      });
      if (confirmed) state.deleteProject(btn.dataset.id);
    });
  });

  container.querySelector("#new-project-btn").addEventListener("click", requestNewProjectSetup);
}

function phaseLabel(project) {
  const phase = PHASES[Math.min(project.currentPhase, PHASES.length - 1)];
  return phase ? phase.title : "Setup";
}

function formatRelativeDate(iso) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const diffMins = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
