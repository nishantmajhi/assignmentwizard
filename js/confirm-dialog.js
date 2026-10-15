/** Custom confirm dialog, used in place of the native window.confirm() so
 *  destructive actions (deleting a project) match the app's own styling
 *  instead of the browser's unstyleable dialog.
 *
 *  Usage: const ok = await confirmDialog({ title, message, confirmLabel, cancelLabel, danger });
 *  Resolves true if the user confirmed, false if they cancelled, hit Escape,
 *  or clicked outside the dialog. Relies on escapeHtml from utils.js. */
function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <h2 id="confirm-dialog-title">${escapeHtml(title || "Are you sure?")}</h2>
        <p id="confirm-dialog-message">${escapeHtml(message || "")}</p>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn-ghost" id="confirm-dialog-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="${danger ? "btn-danger" : "btn-primary"}" id="confirm-dialog-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const previouslyFocused = document.activeElement;
    const confirmBtn = overlay.querySelector("#confirm-dialog-confirm");
    const cancelBtn = overlay.querySelector("#confirm-dialog-cancel");
    const focusables = [cancelBtn, confirmBtn];
    confirmBtn.focus();

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === "Escape") {
        close(false);
        return;
      }
      if (e.key === "Tab") {
        // Small focus trap: only two focusable elements in this dialog.
        e.preventDefault();
        const idx = focusables.indexOf(document.activeElement);
        const nextIdx = e.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === focusables.length - 1 ? 0 : idx + 1);
        focusables[nextIdx].focus();
      }
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKeydown);
  });
}
