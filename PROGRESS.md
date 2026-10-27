# Progress

## Done
- 2026-10-26: Fixed a CI failure in the share-link browser tests (branch `fix/share-note-race`): they read the Share link note right after the click, but the note is written only after the async clipboard copy. They now wait for it (`shareNote` helper). Found on the v0.2.0 release PR (#8).
- 2026-10-26: Fixed the CI failure in the `<mockup-embed>` browser test (branch `fix/embed-test-race`, PR #7): `canvasColours` squashed the wide, short embed canvas to 160×100, leaving the model a few pixels and the count at the threshold (40 on CI, 41 locally). The embed check now counts at the canvas's own size (about 70). A first attempt that polled for 10 s did not help: the model was drawn, the measurement was the problem.
- 2026-10-24: Planned item 5, simple inline embed (branch `feat/inline-embed`, awaiting review/merge): compact mode (`?embed` with `controls`, `mode`, `view`, `finish`, `theme`), the `snapshot` command, `<mockup-embed>` (lazy start near the viewport, stills, at most 8 live, `load="click"`, `link`, errors in the frame), classic `dist/embed.js` plus `dist/embed.mjs`.
- 2026-10-24: Manifest editor, planned items 4 and 2 (PR #3, merged). Phase 1: shared edits, undo history, dialog with live preview and change list. Phase 2: Page (with up axis), Parts, Groups, Views, Finishes, Spec sheet. Phase 3: reordering by drag (mouse, touch, pen), arrow keys and buttons. Phase 4: Raw JSON with checks and Apply; Edit manifest moved to the header beside Load files.
- 2026-10-24: Embedding API, TODO item 1. Merged into main (PR #1).
  - Viewer listens to a parent frame only when its origin is allowed: `?parent=` or a build-time list (`--embed-origin`, `renderPage({ embedOrigins })`). Off by default, so the Claude artifacts are unaffected.
  - Commands: `load` (manifest URL, or manifest object/URL plus files as ArrayBuffers or URLs), `setMode`, `setView`, `setFinish`, `setCut`, `setArrange`, `getManifest`, `scad.setValues`, `scad.render`. Events: `ready`, `loaded`, `change`, `error`. Protocol version 1.
  - Host helper `src/embed.js` (`3d-mockup-viewer/embed`, `dist/embed.js`); docs in `docs/embedding.md`.
  - Browser tests: test host on a second local server; URL load, bytes load, controls, Arrange edit → `change`, origin rejection, OpenSCAD values + render.

## In progress
- Release v0.2.0 (branch `chore/release-0.2.0`): version bumped in package.json, package-lock.json, README install line and the spec status. After merge: tag `v0.2.0` on main, push tags, republish the two Claude artifacts.

## Next
- Tracker side (in `ai-project-tracker`, its own backlog): where mockups live and how an item shows one. It has no mockup or file storage yet.
- Decide the spec's open questions (docs/SPEC.md section 13).
- Planned work in docs/SPEC.md section 12, in order (items 1, 3 and 6 remain; numbers are kept stable).

## Decisions
- 2026-10-26: Release as v0.2.0, not v1.0. The interfaces are not settled yet: this release changes `dist/embed.js` to a classic script, open questions 1 (serve containment) and 2 (copied viewer version) are undecided, and planned items 1 and 3 may change the URL parameters and the editor.
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Embedding API built host-agnostic now; tracker integration later as its own item. | The tracker has no mockup/file storage or embedding in its spec yet. Owner's choice. |
| 2026-10-24 | `load` accepts both URLs and bytes. | Owner's choice; covers hosts that serve files and hosts that hold them. |
| 2026-10-24 | Loads for a `?parent=` host fetch with `credentials: 'omit'`; build-time origins fetch normally. | Anyone can frame the viewer with their own `?parent=`; without this, a framing page could read cookie-protected files on the viewer's origin via `load` + `getManifest`. |
| 2026-10-24 | Commands run one at a time, after the page's own model has loaded; `ready` is sent then. | No races between the page's initial load and host loads. |
| 2026-10-24 | Embed browser tests use a second real local server, not a Playwright-routed origin. | Chromium's local network access checks block a routed "public" origin from framing localhost. |
| 2026-10-24 | `docs/SPEC.md` is the project's source of truth; TODO.md folded into it and deleted. | Owner's request: one detailed spec drives the design. |
| 2026-10-24 | Save (planned item 3) writes to a local file (file picker, download, else Copy); no `mockup serve --writable`, no artifact storage. The viewer never talks to a server beyond reading static files. | Owner: the program must run in the browser without server-side communication. |
| 2026-10-24 | Manifest editor: live preview reuses the main canvas (moved into the dialog; none on phones); part ids read-only; no Add part from file; Copy only until Save exists. | Owner's choices; one WebGL context. |
| 2026-10-24 | Inline embed: iframe of a compact viewer; stills taken in the browser; `src` manifest only until item 1; classic `dist/embed.js` + module `dist/embed.mjs`; static PNG/GIF split out as item 6; no `<mockup-viewer>`. | Owner's choices. |
| 2026-10-24 | Edit manifest moved to the header beside Load files. | Owner: better suited there. |
| 2026-10-24 | Planned items keep their numbers when done ones are removed. | The owner, the design canvas and open questions refer to items by number. |
| 2026-10-24 | Every commit updates docs/SPEC.md with its changes. | Owner's rule: the spec is always current. |
| 2026-10-24 | `<mockup-viewer>` custom element (optional in item 1) not built; noted under the inline-embed item. | Overlaps `<mockup-embed>`; better designed together. |

## Open questions
- See docs/SPEC.md section 13 (nine items, including a path check bug in `mockup serve`).
- Owner is considering two Save questions (spec open questions 8 and 9): the exception to the no-download rule plus how to detect artifacts, and whether Save in an embedded viewer messages the host. Decide before building planned item 3.
