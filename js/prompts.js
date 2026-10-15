function buildExtractionPrompt(projectName) {
  return `You are helping me understand an assessment brief before I start writing.
I'm about to upload/paste my assignment file for "${projectName}". Read it carefully and tell me, in a clearly labeled list:

1. What is being assessed (the task/topic in plain terms)
2. What files or deliverables are expected (e.g. essay, report, presentation, spreadsheet) and how many
3. The required word count or page count (and whether it's a strict limit, a target, or a range)
4. Formatting requirements: font family, font size, line spacing, margins, heading styles, and where each applies (body text, headings, title page, etc.)
5. The required referencing/citation style (e.g. APA 7, Harvard, MLA, IEEE) and any specifics about in-text citations vs. the reference list
6. Any other submission rules (file naming, cover page, plagiarism/AI-use policy, deadline, rubric weighting)

Present your answer as a short labeled list under each numbered heading above. If any of this information is missing from the brief, say so explicitly rather than guessing.`;
}

/** Fallback formatting rules used when Custom formatting is selected in
 *  Preferences but the free-text field is left blank -- my own default
 *  docx styleguide ("Midacker Rules for docx"), rather than a generic
 *  "ask me" placeholder. */
const MIDACKER_DEFAULT_FORMATTING_BULLETS = [
  `Use Times New Roman as the default font throughout, unless the assessment specifies a different font`,
  `Use these font sizes unless the assessment specifies otherwise: 20pt for the Title style, 14pt for Heading 1, and 12pt for all other styles (Heading 2 and below, Normal, etc.)`,
  `Use 1.5 line spacing for all text, unless the assessment specifies otherwise`,
];

/** Shared across the basic and advanced drafting prompts, since the advanced
 *  prompt is the basic prompt reshaped into a Node.js-script request -- the
 *  underlying requirements (word count, citations, formatting) should stay
 *  identical between the two so a fix in one always applies to both. */
function buildCitationInfo(prefs) {
  const referencingStyle = resolveReferencingStyle(prefs);
  const citationNote = referencingStyle
    ? `Do not add citations and references - I will add ${referencingStyle} citations myself`
    : `Do not add citations and references (I will add them myself)`;
  const guideCitationHint = referencingStyle
    ? `what to search for in order to find and format ${referencingStyle} citations and references`
    : `what to search for in order to add citations and references in whatever style the assessment specifies`;
  return { citationNote, guideCitationHint };
}

/** Covers both em dash and en dash -- not just em dash -- since both get
 *  substituted for a plain minus sign. */
function buildDashRule() {
  return `Use a minus sign instead of an em dash or en dash`;
}

function buildSharedFormattingBullets(prefs) {
  const formattingBullets = buildFormattingBullets(prefs);
  const { citationNote } = buildCitationInfo(prefs);

  return [
    `Use "justified" alignment for all sentences`,
    citationNote,
    ...formattingBullets,
    `The Title and the Subtitle must always be center-aligned. Immediately after the Title, the next line must be the built-in "Subtitle" style. Do not put "Heading 1", "Heading 2", or any other heading style directly after the title. They are reserved for the document's actual section headings further down.`,
    `Do not add a custom "Strong" style in the document. Word already has a built-in "Strong" style, and adding a custom one with the same name makes "Strong1" appear in the styles pane`,
    `Follow any structure or section headings specified in the assessment`,
    `Do not add anything in the header or footer (not even page numbers)`,
  ];
}

function buildDraftingPrompt(projectName, prefs) {
  const wordCountLine = buildWordCountLine(prefs);
  const { guideCitationHint } = buildCitationInfo(prefs);
  const formattingSection = buildSharedFormattingBullets(prefs)
    .map((line) => `- ${line}`)
    .join("\n");

  return `Please write a complete docx file based on the uploaded assessment for "${projectName}".
Requirements:
- ${wordCountLine}
- ${buildDashRule()}
- Do not add any information related to marks or percentage in any heading
- Include placeholders for screenshots in the docx file (wherever relevant) as text surrounded by a border (do not use a single-celled table)
- Generate any required diagrams as SVG (only if needed) and present the file for download (do not insert it into the docx file)
- Also produce a {filename of docx}_guide.md that has instructions on what I need to do next (e.g. which software to install in order to complete the task, how to install it, a step by step guide on how to complete the task, how to get screenshots, ${guideCitationHint}, and anything else appropriate for the nature of this assessment)

Formatting:
${formattingSection}`;
}

/** The "Advanced" mode on the Drafting step: the same requirements as the
 *  basic prompt above, but asking for a Node.js script (to run inside
 *  Kiln's vm sandbox) that generates the docx, instead of asking the LLM to
 *  produce the docx directly. */
function buildAdvancedDraftingPrompt(projectName, prefs) {
  const wordCountLine = buildWordCountLine(prefs);
  const { guideCitationHint } = buildCitationInfo(prefs);
  const formattingSection = buildSharedFormattingBullets(prefs)
    .map((line) => `- ${line}`)
    .join("\n");

  return `Please write the Node.js script (using the appropriate npm packages) that would generate the docx file based on the uploaded assessment for "${projectName}" (do not generate the actual docx file yourself, but the other files below must still be generated and presented as real downloadables - not folded into the script).
Requirements:
- ${wordCountLine}
- ${buildDashRule()}
- Do not add any information related to marks or percentage in any heading
- Include placeholders for screenshots in the docx file (wherever relevant) as text surrounded by a border (do not use a single-celled table)
- Generate any required diagrams as SVG (only if needed) and present the file for download (do not insert it into the docx file)
- Also produce a {filename of docx}_guide.md that has step by step instructions on what I need to do next (e.g. how to install software, how to complete the task, how to get screenshots, ${guideCitationHint}, and anything else appropriate for the nature of this assessment)
- The very first line of the script must be a comment containing the intended output filename, e.g. // my-assessment.docx
- Write the script using only var and function declarations (no const, let, or arrow functions at the top level) so it runs safely inside Kiln's vm sandbox
- Do not use require('child_process'), __dirname, fs.rmSync, or any Node built-in that Kiln's sandbox does not expose
- Fix any docx-js element ordering bugs (e.g. w:pBdr children) inline in the script by walking and mutating the paragraph root array before calling Packer.toBuffer - do not rely on post-processing scripts

Formatting:
${formattingSection}`;
}

/** Word count is always given as a range, never a single number: paraphrasing
 *  tends to inflate length, so the model is told to aim for the low end.
 *  10% is subtracted from the target to get that low end. If no target was
 *  entered in Preferences, this defaults to 1000 rather than asking. */
function buildWordCountLine(prefs) {
  if (prefs.wordCountMode === "fixed") {
    const parsed = parseInt(prefs.wordCountValue, 10);
    const target = !isNaN(parsed) && parsed > 0 ? parsed : 1000;
    const lowerBound = Math.max(1, Math.round(target * 0.9));
    return `Word count strictly between ${lowerBound} and ${target} words for the entire docx file (paraphrasing increases length, so aim for the lower end - ignore any word count stated in the assessment file itself and use this range instead)`;
  }
  return `No strict word count for the entire docx file - this is free-writing, so follow whatever the assessment brief specifies and prioritize completeness and quality over hitting a specific number`;
}

function buildFormattingBullets(prefs) {
  if (prefs.formattingMode === "custom") {
    const rules = resolveCustomFormatting(prefs);
    if (rules) {
      return [
        `Use this custom formatting throughout, applied through Word's built-in styles (Title, Subtitle, Heading 1, Heading 2, Normal, etc.) rather than manual text overrides, unless the assessment explicitly requires something else: ${rules}`,
      ];
    }
    // No custom rules typed in Preferences -- fall back to my default docx styleguide.
    return MIDACKER_DEFAULT_FORMATTING_BULLETS.slice();
  }
  return [
    `Use default Word formatting (Microsoft default blue theme, Aptos font and built-in Title, Subtitle, Heading 1, Heading 2, etc. styles) unless the assessment explicitly requires custom formatting`,
  ];
}
