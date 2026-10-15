# Review — AssignmentWizard

First reviewed 2026-09-04. Remediated 2026-09-30 on branch `cleanup/2026-09-30`.
65 node tests (`npm test`, about two seconds, nothing to install) and 10 checks
in real headless Chrome (`npm run test:browser`, about thirty seconds). Nothing
pushed.

No interface was added or changed. A few things now look different on screen
because they were broken; they are listed under "What you will see differently"
below.

## Corrections to the first review

**The first finding was wrong about the code it named.** It said the service
worker needed `self.skipWaiting()` and `clients.claim()`, and that "the new
service worker will not take over an open tab until every tab is closed". Both
calls were in `sw.js` from the first commit, at lines 28 and 39. The finding was
right that users could be stuck on an old version, but for a different reason:
the fetch handler was cache-first, so every file came from the cache filled at
install. A new worker installs only when `sw.js` itself changes. So a deploy that
did not also edit `CACHE_NAME` reached nobody, however long they waited.
Confirmed in Chrome 153.

**The verdict praised the detail that was broken.** It singled out
`.catch(() => cached)` as "the difference between an app that works offline and
one that shows an error when the network is flaky". That line runs only on a
cache miss, when `cached` is `undefined`, and `respondWith(undefined)` is a
network error. It never returned anything cached. Confirmed in Chrome: offline,
any link with a query string on it showed the browser's own error page.

**"Nothing to remove … no build artifacts" was true. "Cleanly built" was
generous.** The review read the service worker and `state.js` and did not run
either. Four defects in the logic lost the user's work, and it saw none of them:

## What was wrong, and is fixed

Each is reproduced against the first commit in the same test run that shows it
fixed. The five marked **(Chrome)** were also reproduced in a real browser.

1. **Two tabs deleted each other's projects.** `state.js` read the projects
   index into memory at load and wrote the whole of it back on every save.
   Tab A's next keystroke therefore removed every project tab B had created
   since A loaded. Opening a project had the same flaw: it wrote this tab's
   load-time copy back over another tab's newer edits. The index is now reread
   on every read and write, with the open project laid over it.
2. **A project name with a double quote in it was cut short, and pressing Save
   renamed it (Chrome).** `escapeHtml` escaped through a text node, which
   leaves quotes alone, and the Setup screen puts the name in `value="…"`. So
   `Essay on "1984"` showed as `Essay on `. Pressing Save on that screen saved
   the truncated name. Because that counts as a rename, every later step went
   back to "not reached" and the hand-edited drafting prompt was thrown away.
   `escapeHtml` now escapes `& < > " '`.
3. **Choosing the option that was already selected threw away the edited
   drafting prompt (Chrome).** For example, clicking "Fixed word count" when it
   was already selected. `updateAndInvalidate` invalidated whether or not
   anything had changed. It now invalidates only when something has.
4. **"Switch assessment" did nothing on a new assessment's Setup screen
   (Chrome).** `app.js` has a flag that keeps Setup on screen after "Start a new
   assessment", and nothing cleared it, so the button redrew Setup. It now calls
   `requestProjectPicker()`, which clears the flag first.
5. **A deploy never reached users (Chrome).** See the correction above. The
   app's own files are now network-first, and a successful fetch refreshes the
   cached copy. If the network has not answered within 3 s and there is a
   cached copy, that copy is served, so a poor connection is no worse than none.
   The Google Fonts files stay cache-first, because their URLs are versioned.
6. **Offline, an uncached page load was a network error (Chrome).** A
   navigation now falls back to the cached `index.html`. Any other uncached
   request is a clean `Response.error()`.
7. **Every response was cached, 404s included.** Under cache-first, a 404
   during a deploy was then served for the life of the worker. Only `ok`
   responses are stored now, plus opaque ones for the fonts, as before.
8. **Install could cache stale files.** `addAll` could be satisfied from the
   HTTP cache. The shell is now requested with `cache: "reload"`.
   `CACHE_NAME` moves to v4, so activation clears whatever v3 cached.
9. **The app showed a blank page if the browser blocks site data.** In that
   case reading `localStorage` throws a `SecurityError`, and `state.js` threw
   at load. It now falls back to an in-memory store: the app works for the
   session and saves nothing.
10. **With the storage quota full, pressed buttons did not redraw the screen.**
    `setItem` threw out of `update()` before `notify()` ran. Writes are now
    caught.

Also: two stored values reached an attribute without escaping, `projectId` in
the picker and `wordCountValue` in Preferences. They now go through
`escapeHtml`.

## What you will see differently

None of these add or change any interface. They are listed because each changes
what appears on screen in some situation:

- Names with quotes in them display in full on the Setup screen.
- "Switch assessment" shows the list of saved assessments from a new
  assessment's Setup screen, which is what it already did everywhere else.
- The list of saved assessments includes ones created in another tab since this
  tab loaded.
- A deployed change appears on the next page load.
- Offline, a link with a query string opens the app instead of the browser's
  error page.

## Deliberately left alone

- **Export to JSON** (P2). This is a new feature with a new button, which is
  interface work. It is the most useful thing left, because everything a
  student does lives in `localStorage` and nowhere else. It is the author's
  decision.
- **`navigator.storage.persist()`** (P2). Firefox answers this call with a
  permission prompt, so calling it changes what the user sees. A version that
  never prompts would call it only when
  `navigator.permissions.query({ name: "persistent-storage" })` already says
  `granted`. That is logic, not interface, but what Chrome returns for an
  installed PWA could not be checked here, so it is left to be done on a real
  install. Also, the review's iOS point overstates the risk. WebKit's seven-day
  cap counts days on which the browser is used, not calendar days. An app added
  to the Home Screen keeps its own count, and every day it is used counts as a
  visit to the site.
- **Personal formatting defaults in settings** (P3). This would need a settings
  screen, which is interface. The README now states exactly what the three
  defaults are, so nobody gets them without knowing.
- **Offline indicator** (P3). Interface.
- **Dating the legacy migration** (P3). The migration predates the only commit,
  so there is no date to give it. It is cheap and tested, so leave it.
- **`LICENSE`** (P3). Which licence is the author's choice. The README says
  there is none.
- **Last write wins for the same project open in two tabs.** Fixing this would
  mean merging field by field, which is not worth it here. Different projects
  in different tabs are safe now. A project deleted in one tab while it is
  being edited in another is saved again by the tab doing the editing. That is
  deliberate: the alternative silently discards what someone is typing. A test
  records it.
- **The confirm dialog focuses Delete first**, so Enter deletes. This is a UX
  question, not a logic one.
- **Word counts written as `1e3`** become 1, because of `parseInt`. A
  `type="number"` field accepts that notation, but no student types it.

## Notes for a future session

- `tests/harness.js` loads the real scripts in `index.html` order into
  `node:vm`. Trap: a throwing getter on a vm global is reported as
  "`localStorage` is not defined", not as the error it threw. So the blocked
  storage is modelled as an object whose every property access throws.
- `loadWorker` in the same file drives `sw.js` with a fake CacheStorage, a
  network function the test supplies, and timers fired by hand. Its
  `dispatchFetch` bounds its wait on `waitUntil`. Without that bound, the
  network-hangs test hangs the suite, which is the one thing it exists to
  prevent in the app.
- In a service worker, register `waitUntil` synchronously in the fetch handler.
  Registering it when the network answers throws `InvalidStateError` if a
  timeout has already answered from the cache. `sw.js` has a comment on this.
- The browser suite goes offline by stopping its server and restarting it on
  the same port, and deploys by overriding a file's content in the server. It
  serves `Cache-Control: no-cache`, so the behaviour it observes is the
  worker's and not the HTTP cache's.
- A new script must be added to `index.html` and to `APP_SHELL`.
  `tests/shell.test.js` fails if either is missed.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs the node checks and the browser suite as two
jobs on `ubuntu-latest`. Nothing has been pushed, so it has not run on GitHub
yet. Every job was run before committing, from a fresh clone of this branch,
the way a runner would run it: Linux jobs in a throwaway Ubuntu 24.04 (the
image `ubuntu-latest` uses) with the same tool versions. 65 and 10.

The node job fetches full history, which the regression tests read (they fail
without it, checked). The browser job fails if the runner prints `SKIP`, which
it does when it finds no Chrome; otherwise a missing browser would read as a
pass.
