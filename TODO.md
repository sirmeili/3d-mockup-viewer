# TODO

Planned work, roughly in priority order. When you pick one up, check the notes, update this file in the same PR, and add browser tests for anything visible.

## 1. Load models from a URL without a manifest

- `viewer.html?file=stl/base.stl&file=stl/lid.stl` (repeatable). Each file becomes a part with automatic grouping, explode and materials.
- Keep `?manifest=` as is. `?model=` is currently an alias for `?manifest=`; decide whether it should accept a model file instead.
- Combine with `?manifest=` so a manifest can add extra files?

## 2. Edit the rest of the manifest in the viewer (spec sheet and page text)

Today Arrange edits groups, explode offsets, see-inside behaviour, materials and part names. Extend editing to the rest of the manifest, so **Copy manifest** (and the embedding API's `change`) produce a complete manifest.

- **Spec sheet (`spec`):** edit section titles. Add, remove and reorder sections. Switch a section between table rows (`rows`: label/value pairs), bullet items (`items`) and paragraph text (`text`). Add, remove and reorder rows and items. The computed "Model data" section stays read-only.
- **Page text:** `name`, `subtitle`, `eyebrow`.
- **Probably also:** `finishes` (add, rename, recolour, remove swatches), `views` and `defaultView` (save the current camera as a named custom view), `units`.
- Edits are remembered per model in the browser like Arrange edits, and cleared by Reset.
- Likely UI: an "Edit details" toggle on the spec panel that turns sections into inline fields, matching Arrange's labelled-field style.

## 3. Save the manifest (not just copy it)

Give the viewer a **Save** button beside **Copy manifest**, using the best method available where the page is running. Feature-detect, and fall back to the next method.

- **Self-hosted with `mockup serve --writable`:** the CLI's server accepts `PUT` for `manifest.json` (and only files under the served folder). Save writes straight back to the project on disk, ready to commit. Off unless the flag is given.
- **Embedded in a host app:** Save sends the manifest to the host (the embedding API's `change` / a `save` message), and the host stores it (e.g. the tracker writing to the project). Uses the embedding API (done, `docs/embedding.md`).
- **Plain browser, self-hosted:** in Chromium, the File System Access API (`showSaveFilePicker`) saves `manifest.json` straight to a chosen file and remembers the handle for later saves. Elsewhere, a normal download.
- **Inside Claude artifacts:** downloads are blocked there. Options are artifact storage (a "Saved mockups" list holding manifests, and optionally the part files, reopenable on any device; check which storage capability the account has) or keep Copy as the fallback.
- Show what happened ("Saved to manifest.json", "Downloaded", "Copied") and keep the in-browser edit memory in sync after a save.
- **Tests:** a browser test for the `--writable` round trip (edit → Save → file on disk changed), and that Save is hidden or falls back where unsupported.

## 4. Manifest editor (full-screen dialog)

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
- **Footer actions:** Apply / Close, Copy manifest, and Save once item 3 exists. The embedding API's `change` event (`docs/embedding.md`) fires from editor changes too.
- **Same data as Arrange:** both edit one in-memory manifest and share the per-model edit memory in the browser, so switching between them never loses work.
- **Tests:** browser tests that open the editor at desktop and phone widths in both themes, reorder by drag and by keyboard, edit a spec section, and confirm Copy/Save output matches. Also an accessibility pass: focus trap in the dialog, Esc to close, labelled controls.

Supersedes the UI part of item 2 (spec and page-text editing happen here). Item 2's data rules still apply.

## 5. Simple inline embed (display only)

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
- **Shares plumbing with the embedding API** (done, `docs/embedding.md`), the full two-way version. Reuse its viewer-side pieces. Left over from that work: an optional `<mockup-viewer manifest="…">` custom element wrapping `embedViewer`; build it alongside `<mockup-embed>` if it's still wanted.
- **Tests:** a test page with several embeds (desktop and phone, light and dark), checking that each draws, controls work, off-screen embeds stay as stills, and nothing scrolls sideways.
- **Docs:** add a section to `docs/embedding.md`.
