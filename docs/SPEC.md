# 3D Mockup Viewer: specification

This is the design document for the project: what it is for, how it works today, the rules it must keep, and the work planned next. Changes to behaviour start here. If the code and this document disagree, that is a bug in one of them; raise it rather than picking one silently.

Detailed references that this document relies on and doesn't repeat in full:
- [docs/manifest.md](manifest.md): every manifest field.
- [docs/embedding.md](embedding.md): the embedding API, helper and protocol.

Status: describes `main` as of 2026-10-26 (package version 0.2.0, tag `v0.2.0`).

---

## 1. Purpose and users

The project turns 3D-printable enclosure designs into interactive, shareable mockups. A mockup shows an assembly (case, lid, board, connectors) assembled, pulled apart, or with the lid hidden, with section cuts for checking clearances and a spec sheet beside the model.

**Owner and primary user:** a hobbyist hardware designer who builds ESP32 enclosures in OpenSCAD and keeps them in separate project repositories.

**Ways it is used:**

| Where | What runs | Typical use |
|---|---|---|
| Claude artifacts | `dist/demo.html` and `dist/openscad/index.html`, published as two artifacts | A public sample, and a place to drop in files without installing anything |
| GitHub Pages | All of `dist/`, deployed on each release | The same pages plus the empty viewers and `embed.js` / `embed.mjs` |
| Any web page or document that allows scripts | `<mockup-embed>` from `embed.js` | A small display-only model view, placed like an image |
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
- Sharing an OpenSCAD mockup as one link that carries the manifest and sources in its fragment, opened read-only (sections 6.15, 7.5).

### Non-goals
- **Not a CAD tool.** Geometry is never edited in the viewer. Shape changes happen in OpenSCAD (or the user's CAD tool) and are re-rendered.
- **No server-side communication.** Everything runs in the browser. The viewer only ever *reads* over the network: its pinned CDN scripts and fonts, and static files it is pointed at (URL mode, embedding `load`). It never uploads, posts or writes anything to a server. Files a user loads stay in the browser tab, and saving means a file on the user's own computer (planned item 3). Static hosting is all a deployment needs; `mockup serve` exists only because browsers restrict `file://`.
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
| `src/embed.js` | Host-side helper for the embedding API (`embedViewer`) and the `<mockup-embed>` element. ES module; the build also converts it to a classic script. |
| `src/landing.html` | GitHub Pages index page. |
| `lib/build.js` | `renderPage` (fill the template) and `buildMockup` (manifest to one HTML page). |
| `lib/scad.js` | `renderPart`: render a `.scad` file to binary STL with the bundled WebAssembly OpenSCAD or a native `openscad`. |
| `lib/stl.js` | ASCII-to-binary STL conversion and triangle counting. |
| `lib/edition.js` | Copies the OpenSCAD runtime files (`openscad.js`, worker, fonts, licence) next to an OpenSCAD-edition page. |
| `lib/share.js` | Share links (sections 6.15, 7.5): `gatherShare` (manifest and `.scad` sources to a payload), `encodeShare` / `decodeShare` (raw deflate and base64url, with the payload checks), `shareLink`. The viewer has its own copy of the encoder and decoder. |
| `lib/index.js` | Package entry; re-exports the library. |
| `cli/mockup.js` | The `mockup` command. |
| `scripts/build-dist.js` | Builds `dist/`. |
| `examples/sensor-box/` | The sample model (`manifest.json` + `sensor_box.scad`), used by the demo pages and tests. |
| `vendor/fonts/` | Liberation Sans (regular, bold, italic, bold italic), Mono and Serif, for OpenSCAD `text()`. |
| `test/` | `build.test.js` and `share.test.js` (Node), and `browser/smoke.test.js` (Playwright), plus `browser/embed-host.html`. |

### 3.2 Template markers

The template has three markers that the build relies on:

| Marker | Purpose |
|---|---|
| `<script id="mockup-data" type="application/json">null</script>` | The build replaces `null` with the page's data: `{ manifest, files: { name: base64 }, dropIn, scad? }`. `null` means an empty viewer. `</` in the JSON is escaped as `<\/`. |
| `<!-- EDITION-SLOT -->` | Edition add-ons are inserted right after it. |
| `<meta name="mockup-embed-origins" content="">` | Build-time list of origins allowed to embed the page (section 9). |

`<meta name="mockup-viewer-version">` carries the package version; `scripts/build-dist.js` stamps it into every `dist/` page.

### 3.3 Script interfaces between pieces

- The viewer exposes `window.mockupViewer`: `buildModel(manifest, files, opts)`, `warn(msg)`, `clearWarnings()`, `setLoading(text)`, `shareLink()`, `canShare`, and getters `manifest` and `partCount`. Editions use it.
- The OpenSCAD add-on exposes `window.mockupScad`: `init(scad, manifest)`, `loadFiles(scadFiles, otherFiles, manifest)`, `shareData(manifest)`, `loadSources(sources, manifest, opts)` (opts: `main`, `values`, `readOnly`, used by share links), `partScad(id)`, `setValues(values)`, `render()`. The viewer calls these when present and otherwise behaves as the standard edition.
- The add-on script runs before the viewer script (the slot comes first in the page), so `window.mockupScad` exists when the viewer starts.

### 3.4 Data flow

```
manifest.json + part files ─┐
.scad sources ─(OpenSCAD)───┤
                            ├─ mockup build ─→ one HTML page (data embedded as base64)
                            ├─ ?manifest= URL ─→ viewer fetches manifest + files
                            ├─ Load files / drag-and-drop ─→ viewer reads local files
                            ├─ embedding API load ─→ host sends URLs or bytes
                            └─ share link (#m=) ─→ viewer unpacks manifest + .scad from its own address
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
2. No `alert`, `confirm`, `prompt`, `window.print` or `<a download>`. (Planned item 3, Save, needs a controlled exception for self-hosted pages; see there.) Clipboard writes happen inside the click handler, with a fallback (Copy manifest shows the JSON in a text box when the clipboard is blocked).
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
- **Parts:** `id`, `name`, `group`, `material`, `file` (default `<id>.stl`), `scad: { file, defines }`, `hidden` (starts switched off: loaded and listed, unticked), `omit` (left out of the mockup: never fetched or rendered, and not in the view, the Parts panel, groups, the size, explode offsets or Model data, but kept in the manifest as written; wins over `hidden`). If every part is omitted the stage says "Every part in this manifest is left out (omit)." and `mockup build` stops.
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
| Share link | `#m=<payload>` in the address | OpenSCAD edition only; replaces any baked model. Opens read-only (section 6.15). |

Each new load replaces the current model. If a load produces no parts, the stage says "No parts could be loaded." and the warnings say why.

## 6. Viewer behaviour

### 6.1 Page layout
One column, max 1080 px: header (eyebrow, title, subtitle, and on drop-in pages the **Load files** and **Edit manifest** buttons; embedded viewers show Edit manifest too), the stage (16:10, at least 320 px tall, at most 72 % of the viewport height), the control strip, a warning line, then the Parts panel beside the spec sheet (stacked below 760 px), and a footer note about units and axes. The OpenSCAD panel, when present, sits above the Parts panel.

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
Buttons come from the manifest's `views` (with manifest-editor edits), or default to Front, Rear, Left, Top and 3/4 (`iso`). The page opens on `defaultView`, else the first listed view, else 3/4 when the manifest lists none. Custom views use a direction in model axes pointing from the model toward the camera. Choosing a view animates the camera to that direction at a distance that fits the model.

### 6.5 Finishes
Swatches come from `finishes` (with manifest-editor edits), or default to Graphite, Bone white, Slate blue and Signal orange; the first is the starting colour. Choosing one recolours every part whose material is `finish`. The Finish group is hidden when no part uses `finish`.

### 6.6 Section cut
Off, X, Y or Z, with a slider for the position across the model (starts at the middle). The cut plane clips every material, including edges.

### 6.7 Parts panel
Lists the parts in the mockup (not omitted ones) by group (groups in order of their first part, both in the edited order: section 6.12), with a visibility checkbox, colour dot, name and triangle count per part. A part with `hidden` starts unticked. On pages where editing is allowed (drop-in and embedded, the pages with Arrange) the checkbox is a manifest edit of `hidden` (section 6.12); elsewhere (baked read-only pages, shared mockups) it only changes the view and nothing is remembered. Hovering a row highlights the part. Group headings are shown only when there is more than one group.

### 6.8 Arrange
Available on drop-in pages, and on any page while it is embedded. **Arrange** turns the Parts panel into an editor:
- Per group: name, explode offset (X, Y, Z, marked "automatic" until set), and see-inside behaviour (Stays, Ghosted, Hidden).
- Per part: name, group (including "New group…"), and material (presets, "From file" for GLB, or a custom colour).
- Edits apply immediately and are remembered in this browser (section 6.12). **Reset** clears Arrange's edits (parts, groups and their order) and can be undone in the manifest editor. **Copy manifest** copies the full manifest (section 6.9), or shows it in a text box when the clipboard is blocked.
- Fields have visible labels; on narrow screens each part's fields stack with their own captions.

### 6.9 The current manifest
"Copy manifest", `getManifest` and the `change` event all produce the same thing: the loaded manifest with every edit from Arrange and the manifest editor applied (section 6.12):
- `up` as shown, and the page fields `name`, `subtitle`, `eyebrow`, `units`, `defaultView`.
- Every part, listed group by group in the shown order (a viewer orders groups by their first part, so this also keeps the group order on reload): `id`, `name`, `group`, `material`, `hidden: true` when it starts hidden, and its source: `file`, or `scad` in the OpenSCAD edition, or the source set in the editor (a part file replaces `scad`; an OpenSCAD source sets `scad: { file, defines }`).
- Then the parts left out of the mockup, with `omit: true`: loaded parts left out by an edit, then the loaded manifest's own omitted parts exactly as written (without `omit` if an edit put them back).
- Every group that has parts, in the shown order: `label`, `explode` rounded to 0.1, `inside` unless `none`.
- `views`, `finishes` and `spec` as edited; otherwise as loaded.
- Any other top-level field as loaded, or as set in Raw JSON. A `defaultView` cleared in Raw JSON is left out.

### 6.10 Spec sheet
One section per `spec` entry (definition list for `rows`, bullets for `items`, a paragraph for `text`), then a computed "Model data" section: overall size, part count, group count, triangle count.

### 6.11 Manifest editor
**Edit manifest**, in the header beside Load files (on the same pages as Arrange: drop-in and embedded; disabled until a model is loaded), opens a modal dialog that edits everything a manifest can hold. Arrange stays as the quick inline tool; both edit the same data (6.12).
- **Design:** the "Mockup Viewer Roadmap Screens" canvas (https://claude.ai/artifact/VsKyA5omGhSTWbQmZJa6Qr), artboards "Editor: Parts & groups", "Editor: Spec sheet", "Editor: Views & finishes", "Editor: Raw JSON with validation" and "Manifest editor on a phone". The canvas uses the old TODO numbers. Where they differ, this section wins: its main-viewer Save menu (saving through `mockup serve --writable`) is superseded by planned item 3; the Raw JSON box has no line-number gutter (problems name their line and Go to line selects it); there is no separate "New group" button.
- **Decisions (2026-10-24):** the live preview is the viewer's own 3D stage, not a second 3D view (browsers cap live WebGL contexts, and one renderer stays in step by definition); part ids are read-only, because they name default files and key remembered edits; there is no "Add part from file" (a possible later enhancement); the footer has Copy manifest only until Save (planned item 3) exists; spec rows and bullets have a grip but no Move up / Move down buttons, to keep phone rows readable.
- **Layout:** a header (title, model name and part count, close button), a section list, the section being edited, a side panel, and a footer. On screens wider than 760 px the side panel holds the live preview, which is the viewer's own 3D stage moved into the dialog while it is open and moved back on close, and the change list. At 760 px and below the dialog fills the screen, the section list becomes a row of tabs, and the side panel is left out.
- **Sections:** Page, Parts, Groups, Views, Finishes, Spec sheet, and (after a divider) Raw JSON. Each starts with a plain-language box saying what it controls and "How to use". The section list shows each section's item count and how many changes it has. Text fields apply as you type; adding, removing or switching something redraws the section.
  - **Page:** title (`name`), subtitle, eyebrow, units, and the up axis (Z or Y). Changing the axis turns the model in place and refits the camera.
  - **Parts:** one card per part, under its group, with its colour dot, name, material and source. **Edit** opens one card at a time: name, id (read-only), group (including "New group…"), material (presets, "From file" for GLB, or a custom colour), and source: a part file, or an OpenSCAD file with defines written as `name = value` pairs (`part = "lid", wall = 3`). A source with no file name or unreadable defines is explained under the fields and not applied. A new source changes the manifest only; the model keeps the shapes already loaded. **Hidden when the page opens** mirrors the Parts checkbox. **Leave out of the mockup** takes the part out at once (disabled for the last part). Hovering a card highlights the part.
  - **Left out:** after the groups, a list of the parts left out: loaded ones left out by an edit (unticking brings them straight back), then the manifest's omitted parts, which were never loaded (unticking records "put back" and says the part shows once the files are loaded again). The change list says "<part>: starts hidden" / "starts shown", "<part>: left out" and "<part>: put back". Arrange doesn't offer omit.
  - **Groups:** one card per group: name, exploded offset (X, Y, Z; editing it switches to Exploded), see-inside behaviour (switches to See inside), the parts in it, and **Delete group**, which moves its parts into groups of their own (disabled for a part that is already alone). New groups come from a part's "New group…".
  - **Views:** every listed view, then the hidden stock views. Stock views have a show checkbox; custom views have a name, their direction, **Use current camera** and **Remove**. One "Opens on" choice sets `defaultView` (and moves the camera there). **Add view from current camera** appends a custom view named "View N". The last remaining view can't be hidden or removed.
  - **Finishes:** each swatch's colour picker and name, **Make default** (moves it to the front; the first is marked "Opens with"), **Remove** (not the last one), and **Add finish**. Editing the colour that is showing recolours the model.
  - **Spec sheet:** each section's title and type ("Shown as": table rows, bullets or paragraph), its rows (label and value), bullets or paragraph text, with add and remove, and **Remove section**. Switching type carries the text over line by line ("Label: value" lines become rows). "Model data" is listed as calculated and always last. **Add section** appends one with an empty bullet.
  - **Reordering:** everything with an order has a grip: parts (within a group, or dropped into another group), groups, listed views, finishes, spec sections, and the rows or bullets of a spec section. Dragging works with a mouse, touch or pen (pointer events; the grip has `touch-action: none`): the item dims, a line shows where it will land, and the section scrolls when the pointer nears its top or bottom edge. Every grip also takes the up and down arrow keys, and part, group, view, finish and spec-section cards have Move up / Move down buttons as well. After a move, focus returns to the moved item's grip.
  - **Raw JSON:** the whole current manifest as text (exactly what Copy manifest produces), with **Format**, **Paste manifest** (from the clipboard; where reading it is blocked, the note says to paste with Ctrl+V), **Revert to current** and **Apply JSON**. The text is checked as you type: valid JSON (with the line from the browser's error), page fields, every loaded part listed once and no others, materials and finish colours, groups (`explode` of 3 numbers, `inside` values), views (stock names, or `name` plus a 3-number `dir`; `defaultView` names one of them) and the spec sheet. Each problem is explained in words with its line number and a **Go to line** button that selects the line; problems are listed in line order, and a list of the checks shows which pass. Apply is disabled until there are no problems and the text differs from the current manifest; the section list shows "N errors" or "not applied" while a draft is pending. **Apply JSON** turns the text into edits on top of the loaded manifest as one undo step, after which every section and the model match it. Values the viewer calculates and Copy manifest writes out (automatic explode offsets, the see-inside default, derived group names) aren't treated as changes. Parts can't be added or removed, because their shapes come from the loaded files. An unapplied draft is kept while switching sections and closing the dialog, until Apply, Revert, Reset section, or a new model.
- **Change list:** every difference from the loaded manifest, in words ("Lid renamed to Top cover", "Lid: explode Z 44 → 48", "Units: "mm" → "in"", "View hidden: Rear", "Opens on: 3/4 → Top", "Slate blue: #4d6b8c → #112233", "Section renamed: Size and fit → Dimensions"), covering every kind of edit, Arrange's included. Order changes read "Groups reordered" and "<group>: parts reordered", compared with the loaded order. List changes are described by name: views, finishes and spec sections that keep their name are compared, others show as added, removed or renamed, and a list whose only change is order shows as reordered. **Reset all** clears every edit.
- **Footer:** Undo and Redo, the change count, **Reset section** (for Groups it also resets the order, which lives in the part order; for Parts it resets part edits and the order), **Copy manifest** (same output as Arrange's) and **Done**. Esc and the close button also close the dialog. Save comes with planned item 3.
- Native `<dialog>` with `showModal()`: the rest of the page is inert while it is open, Esc closes it, and focus returns to the Edit manifest button.

### 6.12 Edits, memory and undo
- Arrange and the manifest editor share one set of edits layered on the loaded manifest:
  `{ parts: {id: {name, group, material, source}}, groups: {id: {label, explode, inside}}, page: {name, subtitle, eyebrow, units, up, defaultView, …}, lists: {views, finishes, spec, partOrder} }`.
  `page` can also hold other top-level fields set in Raw JSON; they are written to the manifest as given.
  A part's patch can also hold `hidden` and `omit` (`omit: false` on a part the manifest omits means "put back"). A part's `source` is `{ kind: 'file', file }` or `{ kind: 'scad', file, defines }`. A list edit holds the whole edited list. `partOrder` is every part id in the shown order, flattened group by group; parts it doesn't name (none, normally) keep their loaded order after it. Groups have no order of their own: they follow their first part, so moving a group moves its parts in `partOrder`. The loaded manifest itself is never changed; "the current manifest" (6.9) is the two combined.
- An edit that brings a value back to the loaded one removes it (a part field, a page field, a whole list, the part order), so the change list and the remembered edits stay minimal. Group names (in Arrange and the editor), and Arrange's part fields, still store a value even when it matches; the change list ignores those.
- Edits are remembered in `localStorage` under `mockupEdits:<manifest name>:<sorted part ids>`, and removed when empty. Edits saved before the `page` and `lists` keys existed still load.
- **Undo history:** every edit records a snapshot of the edits first. Typing in one field (or one explode axis) within 1.5 seconds counts as one step, and an edit that changes nothing isn't recorded. Up to 200 steps. Undo and Redo are in the editor's footer and cover Arrange's edits too. History starts empty for each model and survives an OpenSCAD re-render of the same parts.
- Each edit is remembered, redraws the model and panels, refreshes the editor's change list, and (when embedded) schedules the `change` event.

### 6.13 Compact mode (`?embed`)
What `<mockup-embed>` (9.1) and plain iframes show: `viewer.html?embed&manifest=…`.
- A small inline script at the top of the page sets `data-embed` on the root before the page paints, so the full layout never flashes. CSS then hides everything in the page except the stage and the control strip: header (with Load files and Edit manifest), warnings, parts and spec panels, footer, the OpenSCAD panel, the stage's hint, the Edges toggle and the control labels. The stage fills the frame and the strip sits below it; the page background is transparent.
- Load files and drag-and-drop are off; Arrange and the manifest editor aren't shown even when embedded.
- `controls`: any of `show`, `view`, `finish`, `cut` (comma-separated), or `none` for no strip. Default `show,view,finish`. Hidden groups get `data-off`.
- Starting state, applied after the model loads: `mode` (`assembled`, `exploded`, `inside`), `view` (a listed view name; the camera is refitted either way), `finish` (a finish name or colour).
- `theme=light|dark` forces a theme; otherwise the frame follows the system setting like any page.
- Query strings don't reach pages inside Claude artifacts, so compact mode is for self-hosted viewers.

### 6.14 Messages and failure states
- The loading tag shows progress ("Loading model…", "Reading files…", "Rendering 9 parts…") and final failures.
- Non-fatal problems (missing or unreadable files, skipped file types, OpenSCAD parts that failed) are listed in the warning line under the controls.
- If three.js fails to load, the stage says so and nothing else runs.

### 6.15 Shared mockups (`#m=`)
A page whose address has `#m=<payload>` (a share link) shows the mockup in the link instead of any baked model:
- The payload is decoded and checked (format in `lib/share.js`; the viewer's copy is in the "share links" part of `viewer.html`) and loaded through `mockupScad.loadSources(sources, manifest, { main, values, readOnly: true })`, which renders right away.
- Read-only: Load files, drag-and-drop, Arrange and Edit manifest are hidden (also when framed for embedding). The OpenSCAD panel shows the values with its fields disabled, says "view only", and has no Reset values or Render. The viewing controls all work.
- Remembered edits (6.12) are neither applied nor saved, so the page shows exactly what was sent.
- Parts with `hidden` in the link's manifest start switched off, and their checkboxes still work, for viewing only; omitted parts aren't there at all.
- The footer says "Opened from a share link: view only, made with viewer <version>".
- A damaged link, one made by a newer viewer, or a link opened in the standard edition shows its message in the stage's loading tag; a part that fails to render is reported as usual (7.3).
- The fragment stays in the address bar, so reloading works; changing it to another link reloads the page.

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
- Share link: sources from the link, rendered immediately with the link's values; read-only (6.15).

### 7.5 Share link
**Share link**, in the OpenSCAD panel beside Reset values and Render, copies a link that holds the current mockup (opening one: section 6.15).
- Shown only on a top-level `http(s)` page that isn't embedded (`?embed`) or itself a shared mockup. Claude artifacts run in a frame, so they never show it.
- The link is this page's address (origin and path) plus `#m=<payload>`: `{ v: 1, viewer, manifest, main, sources, values? }`, JSON, raw deflate (fflate), base64url, the same format as `mockup link` (8.3).
  - `manifest` is the current manifest (6.9). Every part must have `scad`; otherwise the note names the mesh parts and points to `mockup build`.
  - `sources` starts from the main file and each part's `scad.file` and follows `include`, `use` and `import()` through the loaded sources (the path relative to the including file, then as written, then by base name). Text sources go in as they are; text-format imports (SVG, DXF, OFF, OBJ, DAT, ASCII STL) are decoded as UTF-8. A binary file, a file that isn't loaded, or more than 40 files stops it with a note naming the file.
  - `values` holds the panel values that differ from their defaults, whether or not they have been rendered.
  - The manifest's `hidden` follows what is showing when Share link is pressed, on any page, so a temporary untick on a read-only page is shared too. Omitted parts travel as written; only the sources the remaining parts need go in. The camera view, mode, finish and section cut don't travel.
- The link is copied inside the click handler. The note under the buttons gives its size and says anyone with it can see the model and read the full source; above 8 KB it adds that some apps cut long links. Where the clipboard is blocked, the link is shown in a text box, selected. Over 64 KB, nothing is copied and the note points to `mockup build`.
- Exposed to the add-on as `window.mockupViewer.canShare` and `shareLink()` (returns `{ link, kb, long }` or throws with the message); the add-on supplies `mockupScad.shareData(manifest)`.

## 8. Node library and CLI

### 8.1 `buildMockup` (`mockup build`)
Reads the manifest. Omitted parts are skipped (not rendered or embedded) and kept in the page's manifest as written. For each other part: renders its `scad` (unless rendering is off), or finds its file (the manifest path, then the STL folder, then `<id>.stl`); converts ASCII STL to binary; embeds the bytes as base64. Rendered STLs are written to the part's `file` path when it has one and no `--stl-dir` was given, else to `<stl-dir>/<id>.stl`. With `--openscad`, `.scad` sources are embedded as well (by base name) and the runtime files are written next to the output. Rendering stops the build at the first part that produces no geometry. Pages are not drop-in by default.

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
| `mockup link <manifest> [--base <url>] [--lib <dir>]` | Prints a share link (7.5) to stdout, and its size and a privacy reminder to stderr. Every part that isn't omitted must have `scad`; omitted parts (mesh ones too) travel in the manifest as written, and their sources stay out unless another part needs them. Sources are keyed by their path relative to the manifest; includes are followed relative to the including file, then in each `--lib` folder (stored at the path where the include resolves). Text-format imports (SVG, DXF, OFF, OBJ, DAT, ASCII STL) go in as text; a binary import, a missing file, more than 40 files or a link over 64 KB stops it with a message. A note above 8 KB. `--base` defaults to `https://sirmeili.github.io/3d-mockup-viewer/openscad/viewer.html`. |
| `mockup render <file.scad> -o <out.stl>` | Renders one STL. `-D name=value` (JSON values, else strings), `--engine`, `--lib`. |
| `mockup serve [dir] [--port 8080]` | Static file server for development. GET only, no CORS headers, `index.html` for folders. |
| `mockup help`, `mockup version` | Usage and version. |

**Compatibility rule:** existing commands and flags keep working across releases. New flags are additive. The `enclosure-mockup` skill must be updated in the same change if that ever can't hold.

### 8.4 Package exports
- `3d-mockup-viewer`: `buildMockup`, `renderPage`, `classicEmbed`, `TEMPLATE`, `SCAD_ADDON`, `SRC_DIR`, `EMBED`, `renderPart`, `scadLiteral`, `FONT_DIR`, `toBinaryStl`, `isAsciiStl`, `triangleCount`, `writeOpenscadEdition`, `encodeShare`, `decodeShare`, `checkShare`, `shareLink`, `gatherShare`, and the share-link constants (`SHARE_VERSION`, `SHARE_NOTE_LENGTH`, `SHARE_MAX_LENGTH`, `SHARE_MAX_FILES`, `SHARE_MAX_BYTES`, `DEFAULT_SHARE_BASE`).
- `3d-mockup-viewer/embed`: `embedViewer`, `defineMockupEmbed`, `PROTOCOL`, `PROTOCOL_VERSION`. Importing it in a browser also registers `<mockup-embed>`.

## 9. Embedding API

Full reference: [docs/embedding.md](embedding.md). The design rules:

- **Off by default.** The viewer listens only when it is framed and its parent's origin is allowed: by `?parent=origin[,origin]`, or by the build-time list (`--embed-origin`), which, when set, makes `?parent=` ignored. Messages must come from `window.parent` with an allowed origin and carry `protocol: 'mockup-viewer'`.
- **Protocol version 1.** Every message carries the version. A breaking change increases it, and the viewer answers other versions with a `version` error.
- **Commands:** `load`, `setMode`, `setView`, `setFinish`, `setCut`, `setArrange`, `getManifest`, `snapshot`, `scad.setValues`, `scad.render`. `snapshot` returns `{ image, width, height }`: a JPEG data URL of the current view painted over the stage's background gradient so it matches the live view, sized in device pixels. They run one at a time, in order, after the page's own model has loaded. Each reply is `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.
- **Events:** `ready` (after the initial load), `loaded` (after every build), `change` (400 ms after the last edit in Arrange or the manifest editor, with the full manifest), `error` (failures not caused by a command).
- **Credentials:** loads requested by a host allowed only through `?parent=` fetch with `credentials: 'omit'`, because anyone can frame the viewer with their own `?parent=`. With a build-time list, fetches send cookies as usual.
- **The viewer UI stays complete when embedded**, and Arrange is available.
- The helper `embedViewer` adds `?parent=`, waits for `ready` (default 30 seconds), resolves relative URLs against the host page, transfers ArrayBuffers, and turns replies into promises.
- **Packaging:** `src/embed.js` is an ES module (the npm export). The build writes it twice: `dist/embed.mjs`, a copy, and `dist/embed.js`, a classic script for `<script src>` made by `classicEmbed` (`lib/build.js`): the same code in a function scope, its exports on `window.mockupViewer`, `import.meta.url` replaced by the script's own URL. The source keeps to syntax that conversion handles; a unit test checks the result parses and runs.

### 9.1 Inline embeds: `<mockup-embed>`
`<mockup-embed src="mockup/manifest.json" height="320" controls="show,view,finish" link>` shows a small, display-only model view in any page. Built on compact mode (6.13) and the embedding API; attribute reference in docs/embedding.md.
- **Attributes:** `src` (manifest URL; a single model file once planned item 1 exists), `height` (px or CSS length, default 320; width fills the container), `controls`, `view`, `mode`, `finish`, `theme` (passed to compact mode; `theme` also styles the element), `link` ("Open full viewer" to `viewer.html?manifest=…`, or the URL given), `load="click"` (start only on a click), `title` (screen-reader name, default "3D model"), `viewer` (viewer page URL; default `viewer.html` beside the script). Changing an attribute that affects the view restarts it.
- **Structure:** a shadow root with a frame (the stage's gradient, rounded), an iframe slot made by `embedViewer` (`?embed`, the attributes as query parameters, and `?parent=`), and a cover button that shows the still and a label ("Show 3D view", "Loading 3D view…", or the error). Colours are custom properties on `:host` with a dark set under `prefers-color-scheme` and `theme`.
- **Live and still:** an `IntersectionObserver` with a 200 px margin starts the 3D view when the embed nears the viewport (unless `load="click"`); a second one with a 1200 px margin releases it when it is far away. Starting keeps the iframe hidden under the cover until `ready` reports a model, then reveals it and takes a still 400 ms later. Releasing takes a fresh still (`snapshot`), then destroys the iframe and its WebGL context (forced after 3 seconds if the frame doesn't answer). Clicking the cover starts it. At most `MAX_LIVE` (8) embeds are live; starting another releases the live one farthest from the middle of the viewport. Without `IntersectionObserver`, embeds start at once. The element's `data-state` is `still`, `loading`, `live` or `error`.
- **Failures:** a viewer error, a load that yields no model, or no `ready` within 60 seconds shows "Couldn't show the 3D view: <reason>" in the frame.
- **Without scripts:** `viewer.html?embed&manifest=…` in a plain iframe.

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
| `embed.js`, `embed.mjs` | `<mockup-embed>` and the embedding helper: classic script and ES module. |
| `examples/sensor-box/` | Sample manifest, rendered STLs and `.scad`, for URL mode. |

`npm install` runs the build if `dist/demo.html` is missing.

### 10.2 Tests
- `npm test` (Node, about 2 seconds): builds the sample from OpenSCAD; builds the OpenSCAD edition with embedded sources; `text()` with the bundled fonts; OpenSCAD literals; ASCII-to-binary STL; the empty viewer's null data tag; embed origins in the page. `share.test.js`: share links for the sample round-trip; include, use, text imports and library folders are followed; binary imports, mesh parts and missing files are refused; damaged, newer, oversized and decompression-bomb links and a malformed `hidden` are rejected; `mockup link` prints a link that decodes.
- `npm run test:browser` (Playwright, about 6 minutes; needs a build and Chromium):
  - Every dist page (demo, OpenSCAD demo, URL mode in both editions) at 1200 px and 400 px, light and dark. Checks: title, no warnings, no horizontal scroll, the canvas is actually drawn (distinct-colour count), exploded and see-inside views, a section cut, Arrange showing one box per group with visible labels, no console errors. On the OpenSCAD demo at desktop/light, a value change and a full re-render.
  - Manifest editor, at desktop/light and phone/dark: opening it (the stage moves into the preview on desktop and still draws), Page edits applied as you type, the change list and count, Undo, Redo, Reset section, Esc and the stage moving back; no sideways scroll. Arrange edits appear in the editor's change list and undo. Parts (read-only id, material, group, source with its error messages), Groups (offset, Delete group and its undo), the up axis, Views (hide, add from camera, opens on), Finishes (recolour, add, make default) and the Spec sheet (rename, switch type, add section, change-list wording), each checked in the copied manifest. Reordering: arrow keys on a grip (focus stays with the moved item), a mouse drag of a part into another group and of a view to the front, group Move down, a finish moved by arrow key, a spec row moved by arrow key, and a touch drag (pointer events with `pointerType: 'touch'`) of a spec section to the top; the copied manifest's part, group, finish, view and spec order; Reset all restores the loaded order. Raw JSON: Edit manifest sits in the header; the box starts with the current manifest; broken JSON gives one problem with its line and Go to line selects it; an unknown part, a missing part, an unknown material and a 2-number `explode` are each explained, with the line; a good edit applies (title, material, explode, finish order) and shows in the change list and the box; one Undo reverts it; Paste, Format and Revert. Every section, Raw JSON included, on a phone in dark mode without sideways scroll.
  - Part visibility, through URL mode with a manifest that hides one part and omits another: the omitted part's file is never fetched and it isn't listed or counted; the hidden part is listed unticked; ticking it is a change ("starts shown"); Leave out in the editor, the Left out list, putting back a never-loaded part, the copied manifest, undo; Raw JSON lists the omitted part, explains a non-boolean `hidden`, and applies `hidden` and `omit`. The share-link test also leaves a part out and checks the recipient never sees it, and that a checkbox on a shared mockup remembers nothing.
  - `<mockup-embed>`, at desktop/light and phone/dark on a page of 20 (classic `embed.js` from a second server): the first goes live and draws with only its chosen controls; its link points at the full viewer; `load="click"` waits and starts on a click; `controls="none"` shows no strip; a missing manifest shows the error; no sideways scroll; never more than 8 live; after scrolling to the bottom, the top embeds hold a JPEG still and no iframe while the bottom ones are live.
  - Compact mode at 600 × 340 in dark mode: only the stage and the chosen controls show, the starting mode, view and finish apply, the model draws, and the page fits its frame both ways; `controls=none` hides the strip.
  - Share links: on the OpenSCAD demo at desktop/light, a changed value and a part switched off, Share link, the copied link decoded by the Node decoder, and the link opened in a fresh page once the sender's page is closed (two software-WebGL pages at once make screenshots flaky); it renders with the value and the part off, read-only: no editing controls, locked fields, "view only" notes, no sideways scroll). A `mockup link` link opened at phone/dark. Damaged, newer-version and standard-edition links show their message. No Share link inside a frame; the clipboard fallback; a mesh part refused with its name.
  - Embedding, with a test host on a second local server: load by URL, controls, a snapshot, coded errors, Arrange edit to `change`, `getManifest`; load by transferred bytes; rejection of hosts that aren't allowed; OpenSCAD `setValues` and `render`.
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
- Edits are remembered per manifest name (as loaded) and part set; renaming the manifest file's `name` or changing the part list starts fresh.
- A part source changed in the manifest editor isn't loaded until the files are loaded again; the editor says so.
- On phones the manifest editor has no live preview; changes show when it closes.
- The manifest editor's section tabs scroll sideways inside their row on narrow phones.
- Raw JSON can't add or remove parts, or remove a top-level field the loaded manifest has (page text and `defaultView` can be emptied instead; a removed `views` or `finishes` list means the defaults, a removed `spec` means none).
- The editor tests run at desktop/light and phone/dark only, not every width and theme.
- `?manifest=`, `?model=`, `?parent=` and `?embed` (with its options) don't work inside Claude artifacts.
- The OpenSCAD edition needs http(s), not `file://`.
- Putting back a part the manifest omitted only shows it after the files are loaded again, because it was never loaded. Arrange's Reset also clears `hidden` and `omit` edits, like every part edit.
- Share links carry OpenSCAD text sources only: no mesh parts and no binary imports (PNG, binary STL), at most 40 files and 64 KB of link. Some apps cut links well before that.
- A share link opens in whatever viewer its address serves; GitHub Pages serves only the latest release, so a newer OpenSCAD engine can render an old link slightly differently.
- Share link isn't offered inside Claude artifacts or other frames, and a shared mockup can't be edited or shared again.
- Share link packs the panel's changed values even if they haven't been rendered yet, so the recipient can see a variant the sender hasn't.
- Browsers limit live WebGL contexts (roughly 16 per page); `<mockup-embed>` keeps at most 8 live, and a released embed forgets how the reader turned or switched it.
- An embed's first picture needs its 3D view to start once: there is no still before then (planned item 6 would give one from the build).
- `<mockup-embed>` needs the viewer to allow the host page's origin (`?parent=`, added automatically); a viewer built with `--embed-origin` only works for the origins listed.

## 12. Planned work

Roughly in priority order. When picking one up, check the notes, update this section in the same change, and add browser tests for anything visible. Numbers stay as first given, so references keep working: done items are removed and their behaviour moves into the sections above (2, editing the spec sheet and page text, and 4, the manifest editor, are both in section 6.11; 5, the inline embed, is in sections 6.13 and 9.1; 7, share links, is in sections 6.15, 7.5 and 8.3, with the owner's decisions of 2026-10-26: GitHub Pages and self-hosted only, read-only on opening, text sources only, an 8 KB note and a 64 KB cap, links always open in the latest viewer and the risk of OpenSCAD engine upgrades is accepted, no embedding-API command; 8, part visibility (`hidden`, `omit`), is in sections 5.1, 6.7, 6.9, 6.11 and 6.12, decided 2026-10-26: omitted parts are skipped entirely, and both can be set in the viewer).

### 1. Load models from a URL without a manifest
- `viewer.html?file=stl/base.stl&file=stl/lid.stl` (repeatable). Each file becomes a part with automatic grouping, explode and materials.
- Keep `?manifest=` as is. `?model=` is currently an alias for `?manifest=`; decide whether it should accept a model file instead.
- Combine with `?manifest=` so a manifest can add extra files?

### 3. Save the manifest to a local file
Give the viewer a **Save** button beside **Copy manifest** that writes `manifest.json` to the user's own computer, straight from the browser. No server is involved: the viewer never sends the manifest anywhere (section 2). Feature-detect and fall back in this order:
- **File System Access API** (Chromium: `showSaveFilePicker`): the user picks where to save, typically the project's mockup folder. Later saves in the same session write to the same file without asking again.
- **Download** (other browsers): `manifest.json` lands in the downloads folder.
- **Copy manifest** where neither works, notably inside Claude artifacts, which block downloads and file pickers.
- Show what happened ("Saved to manifest.json", "Downloaded", "Copied") and keep the in-browser edit memory in sync after a save.
- **To decide before building:**
  - Section 4 rule 2 forbids `<a download>` because it fails silently inside artifacts. Save needs an exception there, and a reliable way to tell it is running inside an artifact (or to detect that the save didn't happen) so it can fall back to Copy.
  - Embedded viewers: the host can already read the manifest (`change` event, `getManifest`). Should Save also post a `save` message to the host page (browser to browser, no server), or behave exactly as above?
- **Tests:** browser tests for each path: the file picker (stubbed in the test), the download (Playwright captures it and the test checks the JSON), and the Copy fallback where both are unavailable.

### 6. Static image of a mockup (for places that strip scripts)
Have `mockup build` optionally write a PNG (and maybe a short turntable GIF) to use as an image linking to the live viewer, e.g. in a GitHub README. Node has no WebGL, so decide first how to render: a small software rasterizer in Node (no new dependency, plainer look) or headless Chromium through Playwright when installed (exact match, optional dependency and browser download). Split out of item 5 on 2026-10-24.

### Outside this repository
- **Tracker integration** (`ai-project-tracker`): decide where a project's mockup lives and how an item shows one, then use the embedding API. The tracker has no mockup or file storage yet; this belongs in its own backlog.

## 13. Open questions

Found while writing this document. Each needs a decision; none has been changed.

1. **`mockup serve` can serve files outside its folder.** The containment check is a string prefix test, and the path is URL-decoded after normalisation. Verified: serving `site/`, the request `GET /..%2Fsite-private/b.txt` returned a file from the sibling folder `site-private/`. The server also listens on every network interface, so this is reachable from the local network. Low impact (a read-only dev server, and only sibling folders whose names start with the served folder's name). Proposed fix: compare with `path.relative`, reject `..`, and listen on `localhost` by default with a flag for the network.
2. **Copied viewers report the wrong version.** `mockup viewer` and `mockup init` write the template's placeholder `<meta name="mockup-viewer-version" content="1.0">`; only `dist/` pages are stamped with the package version (0.2.0). The embedding API's `ready.viewerVersion` passes this value on. Should `renderPage` stamp the version?
3. **Material guessing differs between the CLI and the viewer.** For a part name with no match, `mockup init` writes `plastic-white`, while the viewer gives an unmatched part a colour from a rotating palette. The keyword lists also differ slightly (the viewer also matches `esp`, `uext`, `shield`, `can`, `enclosure`). Should they share one rule?
4. **No time limit on in-browser OpenSCAD renders.** A model that never finishes keeps a worker busy, and the Render button stays disabled. Add a per-job timeout (terminate and replace the worker)?
5. **URL mode's source warnings.** When the OpenSCAD edition fetches sources in URL mode, a failed fetch is reported only for the first N files in the queue, where N is the number of parts. The comparison looks unintended; a missing include further down is silent until the render fails.
6. **Baked mockups can't use Arrange.** Pages built without `--drop-in` hide Arrange (unless embedded). Intended, so a finished mockup stays read-only? If so, say so in docs/manifest.md.
7. **Confirm the non-goals in section 2.** They describe how the project behaves today and what nothing so far has asked for; they weren't written down anywhere before.
8. **Save and the artifact rules (planned item 3).** Section 4 rule 2 forbids `<a download>` because downloads fail silently inside Claude artifacts. Save needs an exception, and a reliable way to tell it is running inside an artifact (or that the save didn't happen) so it can fall back to Copy. Owner is considering.
9. **Save in an embedded viewer (planned item 3).** The host can already read the manifest (`change`, `getManifest`). Should Save also post a `save` message to the host page (browser to browser, no server), or just save a local file as everywhere else? Owner is considering.
