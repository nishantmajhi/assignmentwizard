function renderExtraction(container) {
  const project = state.get();
  const builtPrompt = buildExtractionPrompt(project.projectName);
  const prompt = project.phase1_extractionPromptOverride != null
    ? project.phase1_extractionPromptOverride
    : builtPrompt;

  container.innerHTML = `
    <div class="phase-card">
      <p class="phase-eyebrow">Step 2 of 4</p>
      <h1>Find out what's actually being asked</h1>
      <p class="phase-lede">Copy this prompt into any LLM in another tab, then upload or paste in your assessment brief alongside it. Come back once you have the answer.</p>
      <div class="prompt-box">
        <textarea id="extraction-prompt" class="prompt-textarea" spellcheck="false">${escapeHtml(prompt)}</textarea>
        <button id="copy-btn" class="btn-outline">Copy prompt</button>
      </div>
      <ol class="instructions">
        <li>Open your preferred LLM in a new tab</li>
        <li>Paste the prompt above</li>
        <li>Upload or paste in your assessment brief</li>
        <li>Read the response, then come back here</li>
      </ol>
      <div class="phase-actions">
        <button id="back-btn" class="btn-ghost">Back</button>
        <button id="next-btn" class="btn-primary">I've got the details <span aria-hidden="true">&rarr;</span></button>
      </div>
    </div>
  `;

  const textarea = container.querySelector("#extraction-prompt");
  textarea.addEventListener("input", () => {
    state.patch({ phase1_extractionPromptOverride: textarea.value });
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

  container.querySelector("#back-btn").addEventListener("click", () => state.goToPhase(0));
  container.querySelector("#next-btn").addEventListener("click", () => state.goToPhase(2));
}
