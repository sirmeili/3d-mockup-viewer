# 3D Mockup Viewer: specification

This is the design document for the project: what it is for, how it works today, the rules it must keep, and the work planned next. Changes to behaviour start here. If the code and this document disagree, that is a bug in one of them; raise it rather than picking one silently.

Detailed references that this document relies on and doesn't repeat in full:
- [docs/manifest.md](manifest.md): every manifest field.
- [docs/embedding.md](embedding.md): the embedding API, helper and protocol.

Status: describes `main` as of 2026-10-24 (package version 0.1.0, tag `v0.1.0`, plus the embedding API merged after that tag).

---

## 1. Purpose and users

The project turns 3D-printable enclosure designs into interactive, shareable mockups. A mockup shows an assembly (case, lid, board, connectors) assembled, pulled apart, or with the lid hidden, with section cuts for checking clearances and a spec sheet beside the model.

**Owner and primary user:** a hobbyist hardware designer who builds ESP32 enclosures in OpenSCAD and keeps them in separate project repositories.

**Ways it is used:**

| Where | What runs | Typical use |
|---|---|---|
| Claude artifacts | `dist/demo.html` and `dist/openscad/index.html`, published as two artifacts | A public sample, and a place to drop in files without installing anything |
| GitHub Pages | All of `dist/`, deployed on each release | The same pages plus the empty viewers and `embed.js` |
| Other repositories | The `mockup` CLI, installed from GitHub at a tag | Build a single-file mockup page, or copy in a live viewer that reads `manifest.json` |
| The owner's `enclosure-mockup` Claude skill | The CLI (`npx github:sirmeili/3d-mockup-viewer#<tag> build …`) | Builds per-project mockups automatically |
| Host apps (first target: the owner's `ai-project-tracker`) | The viewer in an iframe, driven by the embedding API | Show and edit a project's mockup inside another app |

## 2. Scope

### In scope
- Viewing assemblies of STL, 3MF and GLB parts in the browser, with grouping, exploded offsets, see-inside behaviour, materials, camera views, finishes, section cuts and a spec sheet.
- Describing a mockup in one JSON manifest, and editing the arrangement visually (Arrange) to produce that manifest.
- Rendering OpenSCAD sources to parts, both at build time (Node) and in the browser (OpenSCAD edition), with the file's top-level values as editable fields.
- Packaging: one self-contained HTML file per mockup, or an empty viewer that loads files live.
- Letting another web app embed and drive the viewer.

### Non-goals
- **Not a CAD tool.** Geometry is never edited in the viewer. Shape changes happen in OpenSCAD (or the user's CAD tool) and are re-rendered.
- **No server or storage of its own.** Files a user loads stay in the browser tab; nothing is uploaded. Saving belongs to the host: the file system, a host app, or (planned) artifact storage.
- **No accounts, permissions or multi-user editing.** The viewer has no notion of a user.
- **No slicing or print preparation.** Orientation, supports and printability are out of scope.
- **No general-purpose model viewer features** such as measurement tools, annotations or animation timelines, unless a planned item adds them.
- **No other CAD formats** (STEP, OBJ for display, FBX). OBJ, SVG, DXF and similar files are accepted only as OpenSCAD inputs.

## 3. Architecture

### 3.1 Pieces

| Path | Role |
|---|---|
| `src/viewer.html` | The viewer **and** the page template. An HTML fragment (no doctype, head or body), because Claude artifacts wrap pages in a skeleton at publish time. One inline script holds all viewer logic. |
| `src/scad-addon.html` | The OpenSCAD edition: a panel (styles, markup, script) inserted at the template's edition slot. Defines `window.mockupScad`. |
| `src/scad-worker.js` | Module Web Worker that renders one OpenSCAD job. Imports `./openscad.js`. |
| `src/embed.js` | Host-side helper for the embedding API (`embedViewer`). ES module. |
| `src/landing.html` | GitHub Pages index page. |
| `lib/build.js` | `renderPage` (fill the template) and `buildMockup` (manifest to one HTML page). |
| `lib/scad.js` | `renderPart`: render a `.scad` file to binary STL with the bundled WebAssembly OpenSCAD or a native `openscad`. |
| `lib/stl.js` | ASCII-to-binary STL conversion and triangle counting. |
| `lib/edition.js` | Copies the OpenSCAD runtime files (`openscad.js`, worker, fonts, licence) next to an OpenSCAD-edition page. |
| `lib/index.js` | Package entry; re-exports the library. |
| `cli/mockup.js` | The `mockup` command. |
| `scripts/build-dist.js` | Builds `dist/`. |
| `examples/sensor-box/` | The sample model (`manifest.json` + `sensor_box.scad`), used by the demo pages and tests. |
| `vendor/fonts/` | Liberation Sans (regular, bold, italic, bold italic), Mono and Serif, for OpenSCAD `text()`. |
| `test/` | `build.test.js` (Node) and `browser/smoke.test.js` (Playwright), plus `browser/embed-host.html`. |

### 3.2 Template markers

The template has three markers that the build relies on:

| Marker | Purpose |
|---|---|
| `<script id="mockup-data" type="application/json">null</script>` | The build replaces `null` with the page's data: `{ manifest, files: { name: base64 }, dropIn, scad? }`. `null` means an empty viewer. `</` in the JSON is escaped as `<\/`. |
| `<!-- EDITION-SLOT -->` | Edition add-ons are inserted right after it. |
| `<meta name="mockup-embed-origins" content="">` | Build-time list of origins allowed to embed the page (section 9). |

`<meta name="mockup-viewer-version">` carries the package version; `scripts/build-dist.js` stamps it into every `dist/` page.

### 3.3 Script interfaces between pieces

- The viewer exposes `window.mockupViewer`: `buildModel(manifest, files, opts)`, `warn(msg)`, `clearWarnings()`, `setLoading(text)`, and getters `manifest` and `partCount`. Editions use it.
- The OpenSCAD add-on exposes `window.mockupScad`: `init(scad, manifest)`, `loadFiles(scadFiles, otherFiles, manifest)`, `loadSources(sources, manifest)`, `partScad(id)`, `setValues(values)`, `render()`. The viewer calls these when present and otherwise behaves as the standard edition.
- The add-on script runs before the viewer script (the slot comes first in the page), so `window.mockupScad` exists when the viewer starts.

### 3.4 Data flow

```
manifest.json + part files ─┐
.scad sources ─(OpenSCAD)───┤
                            ├─ mockup build ─→ one HTML page (data embedded as base64)
                            ├─ ?manifest= URL ─→ viewer fetches manifest + files
                            ├─ Load files / drag-and-drop ─→ viewer reads local files
                            └─ embedding API load ─→ host sends URLs or bytes
                                         │
                                         ▼
                              buildModel(manifest, files)
                                         │
                       parse → parts → groups → explode/inside → panels
                                         │
                            Arrange edits (localStorage) → Copy manifest / change event
```

### 3.5 Runtime dependencies

| Dependency | Version | Loaded from | Used for |
|---|---|---|---|
| three.js core | r128 | cdnjs | Rendering |
| OrbitControls, STLLoader, GLTFLoader | three@0.128.0 | jsDelivr | Camera control, STL and GLB parsing |
| fflate | 0.6.9 | jsDelivr | Unzipping 3MF |
| OpenSCAD WebAssembly (`openscad-wasm-prebuilt`) | 1.2.0 (OpenSCAD 2025.01) | npm; copied to `openscad.js` | CLI rendering and the OpenSCAD edition |
| Archivo, Public Sans, JetBrains Mono | — | Google Fonts | Typography |

Node: `engines` requires 20.6 or newer; CI uses Node 22. The only dev dependency is `playwright` 1.63.0. Licences are listed in `THIRD_PARTY.md`.

## 4. Hosting constraints (the page contract)

These come from where the pages are published, mainly Claude artifacts. Breaking them fails silently there, so they are hard rules for every page in `dist/`:

1. External scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm or unpkg.com, each pinned to an exact version. Stylesheets only from Google Fonts. Everything else inline.
2. No `alert`, `confirm`, `prompt`, `window.print` or `<a download>`. Clipboard writes happen inside the click handler, with a fallback (Copy manifest shows the JSON in a text box when the clipboard is blocked).
3. Colours are CSS custom properties on `:root`, redefined for dark mode under both `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Components use only the tokens. three.js colours are converted from sRGB to linear (`lin()`), and the edge colour follows `--edge` when the theme changes.
4. Works at about 400 px wide with no horizontal page scroll. Side gutters use `max(16px, env(safe-area-inset-left, 0px))`.
5. `localStorage` holds only per-viewer conveniences (Arrange edits, which OpenSCAD panel sections are open). Every access is wrapped in try/catch, and the page works without it.
6. Relative `fetch` works when hosted. Query strings don't reach pages inside Claude artifacts, so `?manifest=` and `?parent=` are for self-hosting only.
7. Page size: Claude artifacts cap pages at 16 MB. `mockup build` warns above 14 MB.

Also respected: `prefers-reduced-motion` (no camera or explode animation), visible focus outlines, labelled controls.

## 5. Inputs

### 5.1 The manifest

One JSON object describes a mockup. Every field is optional except `parts` (and the viewer copes with no manifest at all). Field-by-field reference: [docs/manifest.md](manifest.md). In summary:

- **Page:** `name`, `subtitle`, `eyebrow`, `up` (`"z"` default, or `"y"`), `units` (default `mm`).
- **Parts:** `id`, `name`, `group`, `material`, `file` (default `<id>.stl`), `scad: { file, defines }`.
- **Groups**, keyed by id: `label`, `explode: [x, y, z]`, `inside: "hide" | "ghost" | "none"`.
- **Views:** stock names (`front`, `rear`, `left`, `right`, `top`, `bottom`, `iso`) and custom `{ name, dir: [x, y, z] }`; `defaultView`.
- **Finishes:** `[{ name, color }]`; the first is the default.
- **Spec sheet:** `[{ title, rows | items | text }]`.

Materials: `finish` (takes the current finish colour), `pcb-green`, `pcb-red`, `pcb-blue`, `pcb-black`, `pcb-purple`, `metal`, `brass`, `plastic-black`, `plastic-white`, `rubber`, `led` (emissive), `clear` (50 % opacity), any `#rrggbb`, or `keep` (the file's own material, GLB only). An unknown name falls back to `plastic-white`.

### 5.2 File types

| Type | Reader | Behaviour |
|---|---|---|
| STL (binary or ASCII) | three.js STLLoader | One part. Vertex normals recomputed. The CLI converts ASCII to binary before embedding. |
| 3MF | Built-in reader using fflate and DOMParser | One part per build item, including the production extension (objects split across several `.model` files, as Bambu Studio and PrusaSlicer write). Component transforms are applied; component nesting is followed 16 levels deep. A part's name comes from the object's `name` attribute, else `<file> <n>`. Colours and materials in the 3MF are ignored. |
| GLB | three.js GLTFLoader | One part per mesh, with world transforms applied. The mesh's own material is kept (`keep`) unless the manifest says otherwise. Multi-material meshes use their first material. |
| JSON | — | Treated as the manifest when loaded with Load files. |
| `.scad` | OpenSCAD edition only | Rendered to parts (section 7). |
| SVG, DXF, PNG, DAT, OFF, OBJ | OpenSCAD edition only | Accepted as OpenSCAD inputs (`import()`, `surface()`), not displayed directly. |

A manifest part whose file yields several pieces (a multi-object 3MF or GLB) becomes several parts with ids `<id>-1`, `<id>-2`, …. Duplicate ids get `-b` appended until unique.

### 5.3 How a model gets into the viewer

| Route | Trigger | Notes |
|---|---|---|
| Baked in | `mockup-data` holds files | Built by `mockup build`. Fully offline apart from the CDN scripts. |
| URL | `viewer.html?manifest=<path>` (`?model=` is an alias) when the page has no baked files | Fetches the manifest, then each part's `file` relative to it. In the OpenSCAD edition it also fetches `.scad` sources (following `include`, `use` and `import()`; at most 40 files) and renders any part whose STL is missing. |
| Load files / drag-and-drop | Only on drop-in pages (empty viewers, demo pages, `--drop-in` builds) | Reads local files; nothing leaves the browser. A `.json` file is the manifest. `.scad` files go to the OpenSCAD edition, or produce a warning in the standard edition. |
| Embedding API | Host sends `load` | Manifest URL, or manifest plus files as bytes or URLs (section 9). |

Each new load replaces the current model. If a load produces no parts, the stage says "No parts could be loaded." and the warnings say why.

## 6. Viewer behaviour

### 6.1 Page layout
One column, max 1080 px: header (eyebrow, title, subtitle, Load files button on drop-in pages), the stage (16:10, at least 320 px tall, at most 72 % of the viewport height), the control strip, a warning line, then the Parts panel beside the spec sheet (stacked below 760 px), and a footer note about units and axes. The OpenSCAD panel, when present, sits above the Parts panel.

### 6.2 Scene and camera
- The assembly is centred on its bounding box. Z-up models are rotated so Z points up on screen. When the manifest doesn't set `up`, a model is treated as Y-up only when every file is GLB.
- Orbit controls: drag to rotate, scroll or pinch to zoom, right-drag to pan. Zoom limits are 0.6 to 12 times the model radius.
- The overall size (width × depth × height in model axes) is shown in the stage corner.
- Edges are drawn as lines at a 28° crease angle, except on parts over 400,000 triangles. The **Edges** checkbox hides them.

### 6.3 Show (modes)
- **Assembled:** every group at rest.
- **Exploded:** each group moves by its `explode` offset. Groups without an offset are stacked along the up axis, in order of height, with the bulkiest group fixed and a step of at least 8 units (55 % of the model height).
- **See inside:** groups marked `hide` fade out and groups marked `ghost` turn mostly transparent. With no `inside` set on any group (and more than one group), a group labelled lid, top, cover or cap is hidden; otherwise the topmost group is ghosted.
- Changes animate (unless reduced motion is on), and the camera pulls back or in so the exploded stack stays framed.

### 6.4 Views
Buttons come from the manifest's `views`, or default to Front, Rear, Left, Top and 3/4 (`iso`). Custom views use a direction in model axes pointing from the model toward the camera. Choosing a view animates the camera to that direction at a distance that fits the model.

### 6.5 Finishes
Swatches come from `finishes`, or default to Graphite, Bone white, Slate blue and Signal orange. Choosing one recolours every part whose material is `finish`. The Finish group is hidden when no part uses `finish`.

### 6.6 Section cut
Off, X, Y or Z, with a slider for the position across the model (starts at the middle). The cut plane clips every material, including edges.

### 6.7 Parts panel
Lists parts by group, with a visibility checkbox, colour dot, name and triangle count per part. Hovering a row highlights the part. Group headings are shown only when there is more than one group.

### 6.8 Arrange
Available on drop-in pages, and on any page while it is embedded. **Arrange** turns the Parts panel into an editor:
- Per group: name, explode offset (X, Y, Z, marked "automatic" until set), and see-inside behaviour (Stays, Ghosted, Hidden).
- Per part: name, group (including "New group…"), and material (presets, "From file" for GLB, or a custom colour).
- Edits apply immediately and are remembered in this browser, keyed by the manifest name and the sorted set of part ids. **Reset** clears them. **Copy manifest** copies the full manifest (section 6.9), or shows it in a text box when the clipboard is blocked.
- Fields have visible labels; on narrow screens each part's fields stack with their own captions.

### 6.9 The current manifest
"Copy manifest", `getManifest` and the `change` event all produce the same thing: the loaded manifest with `up`, every part (`id`, `name`, `group`, `material`, and `file`, or `scad` in the OpenSCAD edition) and every group (`label`, `explode` rounded to 0.1, `inside` unless `none`), including Arrange edits. Other fields (views, finishes, spec, page text) pass through unchanged.

### 6.10 Spec sheet
One section per `spec` entry (definition list for `rows`, bullets for `items`, a paragraph for `text`), then a computed "Model data" section: overall size, part count, group count, triangle count.

### 6.11 Messages and failure states
- The loading tag shows progress ("Loading model…", "Reading files…", "Rendering 9 parts…") and final failures.
- Non-fatal problems (missing or unreadable files, skipped file types, OpenSCAD parts that failed) are listed in the warning line under the controls.
- If three.js fails to load, the stage says so and nothing else runs.

## 7. OpenSCAD edition

The OpenSCAD edition is the same viewer with `src/scad-addon.html` inserted, plus runtime files next to the page: `openscad.js` (about 11 MB), `scad-worker.js`, `fonts/` and `OPENSCAD-COPYING.txt`. It needs http(s); `file://` can't load the worker.

### 7.1 Finding the main file and parts
- **Main file:** among loaded `.scad` files, one that no other file includes, preferring one with a part selector; otherwise the first.
- **Part selector:** the variable compared to string literals most often (`part == "lid"`), with at least two distinct values. `all`, `assembly`, `none` and `everything` are ignored.
- **Parts to render**, in order of precedence: the manifest's parts that have `scad`; else one part per part-selector value; else the whole file as one part.
- Dropped files referenced by a different path (`include <../lib/x.scad>`) are aliased to a dropped file with the same base name.

### 7.2 Editable values
Top-level assignments above the first `module` or `function`, in the main file only:
- Numbers, `true`/`false` and double-quoted strings become fields. Other expressions are skipped.
- `/* [Section] */` comments group fields; `/* [Hidden] */` hides the rest of that section.
- A trailing `// [min:max]` or `// [min:step:max]` sets number limits; `// [a, b:Label]` makes a dropdown; other trailing comments, or a comment line just above, become the hint.
- `$fn`, `$fa` and `$fs` get friendly labels. The part selector variable isn't shown.
- Changed fields are highlighted and counted. **Reset values** restores the defaults. Which sections are open is remembered per main file.

### 7.3 Rendering
- **Render** (or Enter in a field) renders every part with the changed values passed as `-D` overrides. A manifest part's own `defines` win over the panel's values.
- A pool of 1 to 3 workers (hardware threads minus one) runs jobs in parallel. Each job uses a fresh OpenSCAD instance, because the WebAssembly build allows only one `callMain` per instance. A worker that doesn't start within 90 seconds is dropped. If workers can't start at all, the page imports the worker module and renders on the main thread.
- Jobs render with `--backend=manifold`. Parts that produce no geometry are retried once with the classic engine.
- The six Liberation fonts are fetched once per worker and installed for `text()`.
- Paths above the main file (`../`) are rebased under a working folder so relative includes resolve.
- After a render the model rebuilds and the camera stays where it was. The "OpenSCAD output" panel shows the log; it opens by itself when a part fails.
- The first render shows "Loading the OpenSCAD engine (about 11 MB, first time only)…".

### 7.4 Starting states
- Baked demo page: STLs are embedded, so the panel shows values without rendering.
- URL mode: STLs are fetched; any part with `scad` and no STL triggers a render of all parts.
- Dropped `.scad` files: rendered immediately.

## 8. Node library and CLI

### 8.1 `buildMockup` (`mockup build`)
Reads the manifest. For each part: renders its `scad` (unless rendering is off), or finds its file (the manifest path, then the STL folder, then `<id>.stl`); converts ASCII STL to binary; embeds the bytes as base64. Rendered STLs are written to the part's `file` path when it has one and no `--stl-dir` was given, else to `<stl-dir>/<id>.stl`. With `--openscad`, `.scad` sources are embedded as well (by base name) and the runtime files are written next to the output. Rendering stops the build at the first part that produces no geometry. Pages are not drop-in by default.

### 8.2 `renderPart` (`mockup render`)
- **wasm** (default): a fresh WebAssembly OpenSCAD per attempt. Files under the root folder (default: the `.scad` file's folder) are copied into its file system: only OpenSCAD-relevant extensions, at most 5 folders deep, at most 60 MB in total, skipping `node_modules`, `.git`, `dist`, `.cache`, `build` and hidden folders. `--lib` folders are mounted and added to `OPENSCADPATH`. Manifold first, then one classic retry.
- **native:** runs `openscad` from PATH, no retry.
- Output under 85 bytes counts as no geometry.

### 8.3 Commands

| Command | Behaviour |
|---|---|
| `mockup build <manifest> -o <out.html>` | Section 8.1. Flags: `--drop-in`, `--openscad`, `--stl-dir`, `--no-render`, `--engine wasm\|native`, `--lib` (repeatable), `--root`, `--title`, `--embed-origin` (repeatable). Warns above 14 MB. |
| `mockup init [dir]` | Creates `dir` (default `./mockup`) with a starter `manifest.json` and an empty `viewer.html`. Refuses if the manifest exists. `--scad <file>` fills parts from the file's part selector (else one `model` part), with materials guessed from names and files under `stl/`. `--openscad`, `--embed-origin`. |
| `mockup viewer <dir>` | Writes the empty viewer (and the OpenSCAD runtime with `--openscad`). Used to refresh a project after upgrading. `--embed-origin`. |
| `mockup render <file.scad> -o <out.stl>` | Renders one STL. `-D name=value` (JSON values, else strings), `--engine`, `--lib`. |
| `mockup serve [dir] [--port 8080]` | Static file server for development. GET only, no CORS headers, `index.html` for folders. |
| `mockup help`, `mockup version` | Usage and version. |

**Compatibility rule:** existing commands and flags keep working across releases. New flags are additive. The `enclosure-mockup` skill must be updated in the same change if that ever can't hold.

### 8.4 Package exports
- `3d-mockup-viewer`: `buildMockup`, `renderPage`, `TEMPLATE`, `SCAD_ADDON`, `SRC_DIR`, `renderPart`, `scadLiteral`, `FONT_DIR`, `toBinaryStl`, `isAsciiStl`, `triangleCount`, `writeOpenscadEdition`.
- `3d-mockup-viewer/embed`: `embedViewer`, `PROTOCOL`, `PROTOCOL_VERSION`.

## 9. Embedding API

Full reference: [docs/embedding.md](embedding.md). The design rules:

- **Off by default.** The viewer listens only when it is framed and its parent's origin is allowed: by `?parent=origin[,origin]`, or by the build-time list (`--embed-origin`), which, when set, makes `?parent=` ignored. Messages must come from `window.parent` with an allowed origin and carry `protocol: 'mockup-viewer'`.
- **Protocol version 1.** Every message carries the version. A breaking change increases it, and the viewer answers other versions with a `version` error.
- **Commands:** `load`, `setMode`, `setView`, `setFinish`, `setCut`, `setArrange`, `getManifest`, `scad.setValues`, `scad.render`. They run one at a time, in order, after the page's own model has loaded. Each reply is `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.
- **Events:** `ready` (after the initial load), `loaded` (after every build), `change` (400 ms after the last Arrange edit, with the full manifest), `error` (failures not caused by a command).
- **Credentials:** loads requested by a host allowed only through `?parent=` fetch with `credentials: 'omit'`, because anyone can frame the viewer with their own `?parent=`. With a build-time list, fetches send cookies as usual.
- **The viewer UI stays complete when embedded**, and Arrange is available.
- The helper `embedViewer` adds `?parent=`, waits for `ready` (default 30 seconds), resolves relative URLs against the host page, transfers ArrayBuffers, and turns replies into promises.

## 10. Build, tests and release

### 10.1 `dist/` (built by `npm run build`, not committed)

| File | Contents |
|---|---|
| `index.html` | Landing page with the version. |
| `demo.html` | Standard viewer with the sample, drop-in. Published as the "3D Mockup Viewer" artifact. |
| `viewer.html` | Empty standard viewer. |
| `openscad/index.html` | OpenSCAD edition with the sample and its sources, drop-in. Published as the "OpenSCAD Mockup Viewer" artifact. |
| `openscad/viewer.html` | Empty OpenSCAD edition. |
| `openscad/openscad.js`, `scad-worker.js`, `fonts/`, `OPENSCAD-COPYING.txt` | OpenSCAD runtime. |
| `embed.js` | Embedding helper. |
| `examples/sensor-box/` | Sample manifest, rendered STLs and `.scad`, for URL mode. |

`npm install` runs the build if `dist/demo.html` is missing.

### 10.2 Tests
- `npm test` (Node, about 2 seconds): builds the sample from OpenSCAD; builds the OpenSCAD edition with embedded sources; `text()` with the bundled fonts; OpenSCAD literals; ASCII-to-binary STL; the empty viewer's null data tag; embed origins in the page.
- `npm run test:browser` (Playwright, about 6 minutes; needs a build and Chromium):
  - Every dist page (demo, OpenSCAD demo, URL mode in both editions) at 1200 px and 400 px, light and dark. Checks: title, no warnings, no horizontal scroll, the canvas is actually drawn (distinct-colour count), exploded and see-inside views, a section cut, Arrange showing one box per group with visible labels, no console errors. On the OpenSCAD demo at desktop/light, a value change and a full re-render.
  - Embedding, with a test host on a second local server: load by URL, controls, coded errors, Arrange edit to `change`, `getManifest`; load by transferred bytes; rejection of hosts that aren't allowed; OpenSCAD `setValues` and `render`.
  - Screenshots go to `test-results/` and should be looked at.
  - `MOCKUP_TEST_CDN_DIR` serves three.js and fflate from a local folder for offline runs.
- Rule: every visible feature gets a browser test.

### 10.3 CI and release
- CI (every push to main and every pull request): `npm ci`, unit tests, build, browser tests; screenshots kept 14 days.
- Release: bump `version` in `package.json` and commit; push a tag `vX.Y.Z`. The release workflow reruns everything, attaches `mockup-viewer-dist.zip` to a GitHub release and deploys `dist/` to GitHub Pages. Other projects upgrade by changing the tag they install. The two Claude artifacts are then republished from `dist/` (steps in CLAUDE.md).

### 10.4 Licensing
The project's code is MIT. The OpenSCAD WebAssembly build is GPL-2.0-or-later: the standard viewer and pages built without `--openscad` don't include it; anything containing `openscad.js` is distributed with `OPENSCAD-COPYING.txt` and treated as GPL. Fonts are SIL OFL 1.1.

## 11. Known limits and quirks

- three.js is pinned to r128, loaded as plain (non-module) scripts. Upgrading means moving to ES module loaders and re-checking every page.
- 3MF colours and materials are ignored; GLB multi-material meshes use one material.
- Parts over 400,000 triangles get no edge lines.
- URL mode in the OpenSCAD edition follows at most 40 source files.
- OpenSCAD renders in the browser have no time limit; a runaway model keeps a worker busy until the page is closed.
- Arrange edits are remembered per manifest name and part set; renaming the manifest or changing the part list starts fresh.
- `?manifest=`, `?model=` and `?parent=` don't work inside Claude artifacts.
- The OpenSCAD edition needs http(s), not `file://`.
- Browsers limit live WebGL contexts (roughly 16 per page), which matters for pages with many embeds (planned item 5).

## 12. Planned work

Roughly in priority order. When picking one up, check the notes, update this section in the same change, and add browser tests for anything visible.

### 1. Load models from a URL without a manifest
- `viewer.html?file=stl/base.stl&file=stl/lid.stl` (repeatable). Each file becomes a part with automatic grouping, explode and materials.
- Keep `?manifest=` as is. `?model=` is currently an alias for `?manifest=`; decide whether it should accept a model file instead.
- Combine with `?manifest=` so a manifest can add extra files?

### 2. Edit the rest of the manifest in the viewer (spec sheet and page text)
Today Arrange edits groups, explode offsets, see-inside behaviour, materials and part names. Extend editing to the rest of the manifest, so **Copy manifest** (and the embedding API's `change`) produce a complete manifest.
- **Spec sheet (`spec`):** edit section titles. Add, remove and reorder sections. Switch a section between table rows (`rows`: label/value pairs), bullet items (`items`) and paragraph text (`text`). Add, remove and reorder rows and items. The computed "Model data" section stays read-only.
- **Page text:** `name`, `subtitle`, `eyebrow`.
- **Probably also:** `finishes` (add, rename, recolour, remove swatches), `views` and `defaultView` (save the current camera as a named custom view), `units`.
- Edits are remembered per model in the browser like Arrange edits, and cleared by Reset.
- Likely UI: an "Edit details" toggle on the spec panel that turns sections into inline fields, matching Arrange's labelled-field style.

### 3. Save the manifest (not just copy it)
Give the viewer a **Save** button beside **Copy manifest**, using the best method available where the page is running. Feature-detect, and fall back to the next method.
- **Self-hosted with `mockup serve --writable`:** the CLI's server accepts `PUT` for `manifest.json` (and only files under the served folder). Save writes straight back to the project on disk, ready to commit. Off unless the flag is given.
- **Embedded in a host app:** Save sends the manifest to the host (the embedding API's `change` / a `save` message), and the host stores it (e.g. the tracker writing to the project).
- **Plain browser, self-hosted:** in Chromium, the File System Access API (`showSaveFilePicker`) saves `manifest.json` straight to a chosen file and remembers the handle for later saves. Elsewhere, a normal download.
- **Inside Claude artifacts:** downloads are blocked there. Options are artifact storage (a "Saved mockups" list holding manifests, and optionally the part files, reopenable on any device; check which storage capability the account has) or keep Copy as the fallback.
- Show what happened ("Saved to manifest.json", "Downloaded", "Copied") and keep the in-browser edit memory in sync after a save.
- **Tests:** a browser test for the `--writable` round trip (edit → Save → file on disk changed), and that Save is hidden or falls back where unsupported.
- Depends on fixing the `mockup serve` path check first (open question 1).

### 4. Manifest editor (full-screen dialog)
A **Manifest editor** button opens a large dialog that edits everything a manifest can hold in one place. Arrange stays as it is, as the quick inline tool. The editor deliberately duplicates its features, so people can work in either.
- **Layout:** a large modal (full screen on phones) with a section list down the side (tabs on narrow screens) and the editing area beside it. The 3D view stays live behind or beside it, so changes are visible as you make them.
- **Every section opens with a short description of what it controls and how to use it,** in plain language, plus a "what you'll see" note where it helps. For example: "Groups are parts that move together. Set how far each group moves in the Exploded view…"
- **Sections, covering every manifest field:**
  - **Page:** `name`, `subtitle`, `eyebrow`, `units`, `up` axis.
  - **Parts:** id, name, file or `scad` (`file` + `defines`), material (presets plus colour picker), group.
  - **Groups:** label, explode X/Y/Z, see-inside behaviour. Create, rename, delete (members move to their own group).
  - **Views:** stock views on/off and their order. Custom views by name and direction, with "Use current camera" to capture one. Default view.
  - **Finishes:** swatches with name and colour. Add, remove, set the default.
  - **Spec sheet:** sections, each with a title and a type (table rows / bullet items / paragraph). Rows, items and sections all editable.
- **Drag and drop to reorder** everything that has an order: parts, groups, views, finishes, spec sections, rows and items. Parts can also be dragged between groups. Every drag has a keyboard alternative (move up/down buttons or arrow keys) and works with touch.
- **Ease of use:** labelled fields everywhere (same style as Arrange), inline validation (duplicate ids, missing files, bad colours) with plain explanations, Undo/Redo, and a "Changes" count with Reset per section and overall.
- **Raw JSON tab** for power users: view and edit the manifest as text, with validation before applying.
- **Footer actions:** Apply / Close, Copy manifest, and Save once item 3 exists. The embedding API's `change` event fires from editor changes too.
- **Same data as Arrange:** both edit one in-memory manifest and share the per-model edit memory in the browser, so switching between them never loses work.
- **Tests:** browser tests that open the editor at desktop and phone widths in both themes, reorder by drag and by keyboard, edit a spec section, and confirm Copy/Save output matches. Also an accessibility pass: focus trap in the dialog, Esc to close, labelled controls.

Supersedes the UI part of item 2 (spec and page-text editing happen here). Item 2's data rules still apply.

### 5. Simple inline embed (display only)
A one-line way to put a small, read-only model view inside a document or page, like an image.
- **Script tag + custom element:**
  ```html
  <script src="https://sirmeili.github.io/3d-mockup-viewer/embed.js"></script>
  <mockup-embed src="mockup/manifest.json" height="320" controls="show,view,finish"></mockup-embed>
  ```
  Attributes:
  - `src`: a manifest URL, or a single model file.
  - `height`: default about 320 px. Width fills the container.
  - `controls`: any of `show`, `view`, `finish`, `cut`, or `none`.
  - `view` / `mode` / `finish`: the starting state.
  - `link`: adds an "Open full viewer" link.
- **Iframe fallback** for pages that don't allow scripts: `viewer.html?embed&manifest=…`.
- **Compact mode:** model only, with a slim control strip (Show, View, Finish swatches) overlaid or below. Drag to rotate, scroll or pinch to zoom. No header, parts list, spec sheet, Arrange, editor or Load files. Respects the page's light/dark mode.
- **Many embeds on a page:** browsers cap live WebGL contexts at roughly 16. Show a still preview until the embed scrolls into view or is clicked, then start the 3D view. Release contexts that scroll far away.
- **Static fallback for places that strip scripts** (e.g. GitHub READMEs): have `mockup build` optionally write a PNG (and maybe a short turntable GIF) to use as an image linking to the live viewer.
- **Shares plumbing with the embedding API**, the full two-way version. Reuse its viewer-side pieces. Note that today's `embed.js` is an ES module, while the snippet above loads it as a classic script; resolve that (two builds, or a module script tag) when building this.
- Left over from the embedding API: an optional `<mockup-viewer manifest="…">` custom element wrapping `embedViewer`. Build it alongside `<mockup-embed>` if it's still wanted.
- **Tests:** a test page with several embeds (desktop and phone, light and dark), checking that each draws, controls work, off-screen embeds stay as stills, and nothing scrolls sideways.
- **Docs:** add a section to `docs/embedding.md`.

### Outside this repository
- **Tracker integration** (`ai-project-tracker`): decide where a project's mockup lives and how an item shows one, then use the embedding API. The tracker has no mockup or file storage yet; this belongs in its own backlog.

## 13. Open questions

Found while writing this document. Each needs a decision; none has been changed.

1. **`mockup serve` can serve files outside its folder.** The containment check is a string prefix test, and the path is URL-decoded after normalisation. Verified: serving `site/`, the request `GET /..%2Fsite-private/b.txt` returned a file from the sibling folder `site-private/`. The server also listens on every network interface, so this is reachable from the local network. Low impact today (a dev server, sibling folders whose names start with the served folder's name), but item 3 plans to let this server write files. Proposed fix: compare with `path.relative`, reject `..`, and listen on `localhost` by default with a flag for the network.
2. **Copied viewers report the wrong version.** `mockup viewer` and `mockup init` write the template's placeholder `<meta name="mockup-viewer-version" content="1.0">`; only `dist/` pages are stamped with the package version (0.1.0). The embedding API's `ready.viewerVersion` passes this value on. Should `renderPage` stamp the version?
3. **Material guessing differs between the CLI and the viewer.** For a part name with no match, `mockup init` writes `plastic-white`, while the viewer gives an unmatched part a colour from a rotating palette. The keyword lists also differ slightly (the viewer also matches `esp`, `uext`, `shield`, `can`, `enclosure`). Should they share one rule?
4. **No time limit on in-browser OpenSCAD renders.** A model that never finishes keeps a worker busy, and the Render button stays disabled. Add a per-job timeout (terminate and replace the worker)?
5. **URL mode's source warnings.** When the OpenSCAD edition fetches sources in URL mode, a failed fetch is reported only for the first N files in the queue, where N is the number of parts. The comparison looks unintended; a missing include further down is silent until the render fails.
6. **Baked mockups can't use Arrange.** Pages built without `--drop-in` hide Arrange (unless embedded). Intended, so a finished mockup stays read-only? If so, say so in docs/manifest.md.
7. **Confirm the non-goals in section 2.** They describe how the project behaves today and what nothing so far has asked for; they weren't written down anywhere before.
