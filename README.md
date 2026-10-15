# AssignmentWizard

A four-step wizard that helps a student scope an assessment and write a prompt
for drafting it. It does not call an LLM itself. It writes the prompts, you paste
them into whichever LLM you use in another tab, and it keeps your answers
organised between steps.

It is plain HTML, CSS and JavaScript: no build step, no backend, no dependencies.
It runs from a double-clicked `index.html`, and it installs as a Progressive Web
App when served over HTTPS.

## The four steps

1. **Setup.** Name the assessment.
2. **Extract.** The app gives you a prompt that asks an LLM to read your
   assessment brief and list what is being assessed, the deliverables, the word
   count, the formatting rules, the referencing style and any other submission
   rules. It tells the model to say when the brief leaves something out rather
   than guess. You can edit the prompt before copying it.
3. **Preferences.** Enter what you learned:
   - **Word count.** Fixed or free. A fixed count becomes a range from 90% of
     your target up to the target, because paraphrasing tends to add length.
     If you leave it blank the range is 900 to 1000.
   - **Formatting.** Microsoft Office defaults, or your own rules as free text.
     If you choose custom and leave the text blank, three built-in rules apply:
     Times New Roman; 20pt title, 14pt Heading 1 and 12pt for everything else;
     1.5 line spacing.
   - **Referencing style.** Pick from the list, or choose Other and type it.
4. **Draft.** The app combines the name and your preferences into a drafting
   prompt, which you can edit before copying. **Basic** asks the LLM for a
   `.docx`. **Advanced** asks for a Node.js script that generates the `.docx`,
   written to run inside the sandbox of Kiln, the author's docx-building tool.

You can go back to any step you have reached from the left-hand panel. If you
change something a later step depends on, such as the name or a preference,
the later steps go back to "not reached" and any prompt you had edited by hand
is replaced with a freshly generated one. Your answers are kept. Choosing the
option that was already selected changes nothing.

Check your institution's policy on using AI in assessed work before you use
this. The extraction prompt asks the model to find that policy in the brief.

## Saved assessments

Each assessment you name is saved as its own project. When you have saved
projects and none is open, the app shows a list where you can open or delete
one, or start another. **Switch assessment** in the left-hand panel returns to
that list. **Start a new assessment** on the last step does not delete
anything.

Projects are stored in your browser's `localStorage`, on your device only:

| Key | Holds |
| --- | --- |
| `assignmentwizard:projects` | every project, as an object keyed by project ID |
| `assignmentwizard:activeProjectId` | the project that is open |

Clearing your browser's data for the site deletes them. There is no export yet.

The app can be open in more than one tab. Each save rereads what is stored, so
one tab does not delete projects another tab created. If the same project is
open and edited in two tabs, the tab that saves last wins.

If the browser refuses storage altogether, for example because site data is
blocked, the app still works but saves nothing.

Data saved by versions before multiple projects existed, under
`assignmentwizard:project`, is moved into the current format the first time the
app loads, and the old key is removed.

## Running it

**From the file.** Open `index.html` in a browser. Everything works except
installing and the service worker, which browsers do not allow on `file://`.
The app notices this and does not try to register the service worker. Headings
and body text use Rajdhani and Inter from Google Fonts. Without a network
connection the browser uses its own fonts instead.

**Served locally:**

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Browsers treat `localhost` as secure, so the
service worker registers and the app can be installed.

**Deployed.** Put the folder on any static host that serves HTTPS, such as
GitHub Pages or Netlify.

## Offline and updates

`sw.js` precaches the app's files when it installs.

- **Online**, the app's own files come from the network, and each response
  refreshes the cached copy. A deploy reaches users on their next page load.
  You do not need to change `CACHE_NAME`.
- **On a slow connection**, if the network has not answered within three
  seconds, the cached copy is used.
- **Offline**, files come from the cache. A page load that has no exact cached
  entry, such as a link with a query string, opens the cached app.
- **Google Fonts** files are served from the cache first, because their URLs
  change whenever their content does.

A new version of `sw.js` takes over immediately, without waiting for tabs to
close, and deletes the caches of older versions.

## Project structure

```
index.html                 the page: a left and a right pane, and the scripts in load order
manifest.json              PWA manifest
sw.js                      service worker
css/styles.css             all styling
js/
  state.js                 saved projects, the open project, and what an edit invalidates
  utils.js                 escapeHtml, the referencing-style list, reading older saved formats
  confirm-dialog.js        the delete confirmation
  prompts.js               the extraction and drafting prompt templates
  stepper.js               the left-hand progress panel
  project-picker.js        the saved-assessments list
  phases/phase0-setup.js ... phase3-drafting.js   one file per step
  app.js                   starts the app and decides which screen to show
icons/                     192 and 512 px icons, and a 512 px maskable one
tests/                     see below
```

The scripts are classic `<script>` tags, not ES modules, and share one global
scope. That is deliberate: browsers block ES module imports on `file://`, and
opening the file directly is meant to work. So a new script must be added in
two places:

- `index.html`, before anything that uses it and before `app.js`
- `APP_SHELL` in `sw.js`, or it will be missing offline

The tests check both.

## Tests

You need Node 22 or later. There is nothing to install.

```bash
npm test                 # node --test: state, prompts, escaping, the service worker, file consistency
npm run test:browser     # the app and its service worker, driven in a real Chrome
npm run test:original    # the browser checks against the first commit; every regression check must fail
```

`npm test` loads the real scripts, in the order `index.html` lists them, into a
`node:vm` context with a fake `localStorage`. It drives `sw.js` through its
install, activate and fetch handlers against a fake cache and network. Every
test named `regression:` also runs its scenario against the first commit, and
asserts that the first commit gets it wrong.

The browser suite serves the app over loopback, and drives headless Chrome over
the DevTools protocol, using Node's own `WebSocket`. It types and clicks, deploys
a changed file, and goes offline by stopping the server. If it cannot find
Chrome it prints `SKIP` and exits 0. Set `CHROME` to the executable's path if
Chrome is somewhere unusual.

## Design

| Colour | Hex | Used for |
| --- | --- | --- |
| Orange | `#DE5307` | primary actions, active and completed steps |
| Dark orange | `#A83D05` | hover and pressed states |
| Orange tint | `#FBE4D6` | selected toggles |
| Near-black | `#1C1919` | left-pane background, text |
| White | `#FFFFFF` | right-pane background |

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
