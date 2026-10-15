function renderDrafting(container) {
  const project = state.get();
  const prefs = project.phase2_preferences;
  const mode = project.phase3_promptMode === "advanced" ? "advanced" : "basic";

  const basicBuilt = buildDraftingPrompt(project.projectName, prefs);
  const advancedBuilt = buildAdvancedDraftingPrompt(project.projectName, prefs);
  const basicPrompt = project.phase3_draftingPromptOverrideBasic != null
    ? project.phase3_draftingPromptOverrideBasic
    : basicBuilt;
  const advancedPrompt = project.phase3_draftingPromptOverrideAdvanced != null
    ? project.phase3_draftingPromptOverrideAdvanced
    : advancedBuilt;
  const activePrompt = mode === "advanced" ? advancedPrompt : basicPrompt;
  const overrideField = mode === "advanced" ? "phase3_draftingPromptOverrideAdvanced" : "phase3_draftingPromptOverrideBasic";

  container.innerHTML = `
    <div class="phase-card">
      <p class="phase-eyebrow">Step 4 of 4</p>
      <h1>Your drafting prompt</h1>
      <p class="phase-lede">Copy this into your LLM tab along with the assessment brief and the details you extracted earlier, to generate your first draft. You can edit the text below before copying it.</p>

      <fieldset class="toggle-group">
        <legend>Prompt type</legend>
        <div class="toggle-pair">
          <button type="button" class="toggle-option ${mode === "basic" ? "is-selected" : ""}" data-mode="basic">Basic</button>
          <button type="button" class="toggle-option ${mode === "advanced" ? "is-selected" : ""}" data-mode="advanced">Advanced (Node.js script)</button>
        </div>
      </fieldset>

      <div class="prompt-box">
        <textarea id="drafting-prompt" class="prompt-textarea" spellcheck="false">${escapeHtml(activePrompt)}</textarea>
        <button id="copy-btn" class="btn-outline">Copy prompt</button>
      </div>
      <div class="phase-actions">
        <button id="back-btn" class="btn-ghost">Back</button>
        <button id="restart-btn" class="btn-primary">Start a new assessment</button>
      </div>
    </div>
  `;

  // Basic/Advanced is structural (swaps the textarea content), so this uses
  // update() -> re-render, same as the toggles in Preferences. Each mode
  // keeps its own saved override, so switching back and forth doesn't lose
  // whatever was typed in either one.
  container.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.update({ phase3_promptMode: btn.dataset.mode });
    });
  });

  const textarea = container.querySelector("#drafting-prompt");
  textarea.addEventListener("input", () => {
    state.patch({ [overrideField]: textarea.value });
  });

  container.querySelector("#copy-btn").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      e.target.textContent = "Copied";
    } catch (err) {
      e.target.textContent = "Select the text above to copy";
    }
    setTimeout(() => { e.target.textContent = "Copy prompt"; }, 1600);
  });

  container.querySelector("#back-btn").addEventListener("click", () => state.goToPhase(2));
  container.querySelector("#restart-btn").addEventListener("click", () => {
    // This project stays saved (see the picker for deleting projects) --
    // we're just deselecting it and opening a blank Setup screen.
    requestNewProjectSetup();
  });
}
