/** Safe in element text and in quoted attribute values, which is where the
 *  templates put it. (A text node's innerHTML leaves quotes unescaped, so it
 *  is not safe in an attribute.) */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Dropdown options for the referencing-style preference. "Other" is handled
 *  separately in the UI (it reveals a free-text field) so it isn't listed here. */
const REFERENCING_STYLES = [
  "APA 7th edition",
  "APA 6th edition",
  "MLA 9th edition",
  "Harvard",
  "Chicago (Author-Date)",
  "Chicago (Notes-Bibliography)",
  "IEEE",
  "Vancouver",
  "OSCOLA",
  "AMA (American Medical Association)",
  "ASA (American Sociological Association)",
  "CSE (Council of Science Editors)",
  "Turabian"
];

/** Resolves the effective referencing-style text from preferences, tolerating
 *  older saved projects that only had a single free-text `referencingStyle`
 *  field (before the dropdown + "Other" field existed). */
function resolveReferencingStyle(prefs) {
  if (prefs.referencingStyleChoice !== undefined) {
    return prefs.referencingStyleChoice === "Other"
      ? (prefs.referencingStyleOther || "")
      : (prefs.referencingStyleChoice || "");
  }
  return prefs.referencingStyle || "";
}

/** Resolves the effective custom-formatting text from preferences, tolerating
 *  older saved projects that split this into separate font/fontSize fields. */
function resolveCustomFormatting(prefs) {
  if (prefs.customFormatting !== undefined) return prefs.customFormatting || "";
  return [prefs.font, prefs.fontSize].filter(Boolean).join(", ");
}
