function renderPreferences(container) {
  const project = state.get();
  const prefs = project.phase2_preferences;

  // Tolerates older saved projects that predate the dropdown + "Other" field.
  const referencingChoice = prefs.referencingStyleChoice !== undefined
    ? prefs.referencingStyleChoice
    : (prefs.referencingStyle && !REFERENCING_STYLES.includes(prefs.referencingStyle) ? "Other" : (prefs.referencingStyle || ""));
  const referencingOther = prefs.referencingStyleChoice !== undefined
    ? (prefs.referencingStyleOther || "")
    : (referencingChoice === "Other" ? (prefs.referencingStyle || "") : "");
  const customFormattingValue = resolveCustomFormatting(prefs);

  container.innerHTML = `
    <div class="phase-card">
      <p class="phase-eyebrow">Step 3 of 4</p>
      <h1>Set your constraints</h1>
      <p class="phase-lede">Use what the LLM told you about the brief to fill these in. They'll shape your drafting prompt in the next step.</p>

      <fieldset class="toggle-group">
        <legend>Word count</legend>
        <div class="toggle-pair">
          <button type="button" class="toggle-option ${prefs.wordCountMode === "fixed" ? "is-selected" : ""}" data-field="wordCountMode" data-value="fixed">Fixed word count</button>
          <button type="button" class="toggle-option ${prefs.wordCountMode === "free" ? "is-selected" : ""}" data-field="wordCountMode" data-value="free">Free writing</button>
        </div>
        <input
          id="word-count-value"
          class="text-input ${prefs.wordCountMode === "fixed" ? "" : "is-hidden"}"
          type="number"
          min="0"
          placeholder="e.g. 1000"
          value="${escapeHtml(prefs.wordCountValue || "")}"
        />
      </fieldset>

      <fieldset class="toggle-group">
        <legend>Formatting</legend>
        <div class="toggle-pair">
          <button type="button" class="toggle-option ${prefs.formattingMode === "custom" ? "is-selected" : ""}" data-field="formattingMode" data-value="custom">Custom formatting</button>
          <button type="button" class="toggle-option ${prefs.formattingMode === "ms_default" ? "is-selected" : ""}" data-field="formattingMode" data-value="ms_default">Microsoft Office default</button>
        </div>
        <textarea
          id="custom-formatting-input"
          class="text-input ${prefs.formattingMode === "custom" ? "" : "is-hidden"}"
          rows="3"
          placeholder="List any formatting rules from the brief, e.g. Times New Roman 12pt, double-spaced, 1 inch margins, page numbers bottom-right"
        >${escapeHtml(customFormattingValue)}</textarea>
      </fieldset>

      <fieldset class="toggle-group">
        <legend>Referencing style</legend>
        <select id="referencing-select" class="text-input">
          <option value="" ${referencingChoice === "" ? "selected" : ""}>Select a style...</option>
          ${REFERENCING_STYLES.map((style) => `<option value="${escapeHtml(style)}" ${referencingChoice === style ? "selected" : ""}>${escapeHtml(style)}</option>`).join("")}
          <option value="Other" ${referencingChoice === "Other" ? "selected" : ""}>Other</option>
        </select>
        <input
          id="referencing-other-input"
          class="text-input ${referencingChoice === "Other" ? "" : "is-hidden"}"
          type="text"
          placeholder="Type the referencing style name"
          value="${escapeHtml(referencingOther)}"
        />
      </fieldset>

      <div class="phase-actions">
        <button id="back-btn" class="btn-ghost">Back</button>
        <button id="next-btn" class="btn-primary">Generate drafting prompt <span aria-hidden="true">&rarr;</span></button>
      </div>
    </div>
  `;

  // Toggle buttons are structural (show/hide fields), so these use update() -> re-render.
  // They also invalidate phase 3 if it was already reached, since the drafting
  // prompt is built from these preferences (see state.updateAndInvalidate).
  container.querySelectorAll(".toggle-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { field, value } = btn.dataset;
      const updated = { ...state.get().phase2_preferences, [field]: value };
      state.updateAndInvalidate({ phase2_preferences: updated }, 2);
    });
  });

  // The referencing dropdown is structural too (it shows/hides the "Other" field).
  container.querySelector("#referencing-select").addEventListener("change", (e) => {
    const updated = {
      ...state.get().phase2_preferences,
      referencingStyleChoice: e.target.value,
      referencingStyleOther: state.get().phase2_preferences.referencingStyleOther || ""
    };
    state.updateAndInvalidate({ phase2_preferences: updated }, 2);
  });

  // Free-text fields use patch() (no re-render) so typing doesn't lose focus.
  bindText(container, "#word-count-value", "wordCountValue");
  bindText(container, "#custom-formatting-input", "customFormatting");
  bindText(container, "#referencing-other-input", "referencingStyleOther");

  container.querySelector("#back-btn").addEventListener("click", () => state.goToPhase(1));
  container.querySelector("#next-btn").addEventListener("click", () => state.goToPhase(3));
}

function bindText(container, selector, field) {
  const el = container.querySelector(selector);
  if (!el) return;
  el.addEventListener("input", () => {
    const prefs = { ...state.get().phase2_preferences, [field]: el.value };
    state.patchAndInvalidate({ phase2_preferences: prefs }, 2);
  });
}
