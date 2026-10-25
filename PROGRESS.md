# Progress

## Done
- 2026-10-24: Embedding API, TODO item 1. Merged into main (PR #1).
  - Viewer listens to a parent frame only when its origin is allowed: `?parent=` or a build-time list (`--embed-origin`, `renderPage({ embedOrigins })`). Off by default, so the Claude artifacts are unaffected.
  - Commands: `load` (manifest URL, or manifest object/URL plus files as ArrayBuffers or URLs), `setMode`, `setView`, `setFinish`, `setCut`, `setArrange`, `getManifest`, `scad.setValues`, `scad.render`. Events: `ready`, `loaded`, `change`, `error`. Protocol version 1.
  - Host helper `src/embed.js` (`3d-mockup-viewer/embed`, `dist/embed.js`); docs in `docs/embedding.md`.
  - Browser tests: test host on a second local server; URL load, bytes load, controls, Arrange edit → `change`, origin rejection, OpenSCAD values + render.

## In progress
- 2026-10-24: Planned item 4, manifest editor (branch `feat/manifest-editor`). Phases 1 and 2 done: shared edits (parts, groups, page, lists), undo history, dialog with live preview and change list, and all six sections (Page with up axis, Parts, Groups, Views, Finishes, Spec sheet). Phase 3 done: reordering by drag (mouse, touch, pen), arrow keys on grips and up/down buttons, stored as one part order. Phase 4 next: the Raw JSON section.

## Next
- Tracker side (in `ai-project-tracker`, its own backlog): where mockups live and how an item shows one. It has no mockup or file storage yet.
- Decide the spec's open questions (docs/SPEC.md section 13).
- Planned work in docs/SPEC.md section 12, in order.

## Decisions
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
| 2026-10-24 | Every commit updates docs/SPEC.md with its changes. | Owner's rule: the spec is always current. |
| 2026-10-24 | `<mockup-viewer>` custom element (optional in item 1) not built; noted under the inline-embed item. | Overlaps `<mockup-embed>`; better designed together. |

## Open questions
- See docs/SPEC.md section 13 (nine items, including a path check bug in `mockup serve`).
- Owner is considering two Save questions (spec open questions 8 and 9): the exception to the no-download rule plus how to detect artifacts, and whether Save in an embedded viewer messages the host. Decide before building planned item 3.
