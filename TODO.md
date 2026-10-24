# TODO

Planned work, roughly in priority order. When you pick one up, check the notes, update this file in the same PR, and add browser tests for anything visible.

## 1. Embedding API for host pages (iframe + messages)

Let another app, starting with the owner's project tracker, drive the viewer inside an iframe.

- **Before building:** read the tracker repo and shape the API around how it stores projects and talks to Claude Code.
- **Host → viewer messages:**
  - `load`: manifest (object or URL) plus files (ArrayBuffer, transferred, or URL)
  - `setMode`, `setView`, `setFinish`, `setCut`
  - `setArrange` (editing on/off)
  - `getManifest`
  - OpenSCAD edition: `scad.setValues`, `scad.render`
- **Viewer → host messages:**
  - `ready`
  - `loaded` (part count, groups, overall size, warnings)
  - `change` (debounced, full manifest after Arrange or spec edits)
  - `error`
- Every message carries a protocol version.
- **Security:** accept messages only from allowed origins (`?parent=` or a build-time setting). Off by default, so the Claude artifacts are unaffected.
- **Host helper** `embed.js` (exported as `3d-mockup-viewer/embed`): `embedViewer(el, opts)` returning `load()`, `setView()`, `on('change')` and the rest. Optionally a `<mockup-viewer manifest="…">` custom element.
- **Tests:** a test host page that embeds the viewer, plus browser tests for the round trip (load → edit → change event) and for origin rejection.
- **Docs:** `docs/embedding.md`.

## 2. Load models from a URL without a manifest

- `viewer.html?file=stl/base.stl&file=stl/lid.stl` (repeatable). Each file becomes a part with automatic grouping, explode and materials.
- Keep `?manifest=` as is. `?model=` is currently an alias for `?manifest=`; decide whether it should accept a model file instead.
- Combine with `?manifest=` so a manifest can add extra files?

## 3. Edit the rest of the manifest in the viewer (spec sheet and page text)

Today Arrange edits groups, explode offsets, see-inside behaviour, materials and part names. Extend editing to the rest of the manifest, so **Copy manifest** (and the embedding API's `change`) produce a complete manifest.

- **Spec sheet (`spec`):** edit section titles. Add, remove and reorder sections. Switch a section between table rows (`rows`: label/value pairs), bullet items (`items`) and paragraph text (`text`). Add, remove and reorder rows and items. The computed "Model data" section stays read-only.
- **Page text:** `name`, `subtitle`, `eyebrow`.
- **Probably also:** `finishes` (add, rename, recolour, remove swatches), `views` and `defaultView` (save the current camera as a named custom view), `units`.
- Edits are remembered per model in the browser like Arrange edits, and cleared by Reset.
- Likely UI: an "Edit details" toggle on the spec panel that turns sections into inline fields, matching Arrange's labelled-field style.

## 4. Save the manifest (not just copy it)

Give the viewer a **Save** button beside **Copy manifest**, using the best method available where the page is running. Feature-detect, and fall back to the next method.

- **Self-hosted with `mockup serve --writable`:** the CLI's server accepts `PUT` for `manifest.json` (and only files under the served folder). Save writes straight back to the project on disk, ready to commit. Off unless the flag is given.
- **Embedded in a host app:** Save sends the manifest to the host (the embedding API's `change` / a `save` message), and the host stores it (e.g. the tracker writing to the project). Depends on item 1.
- **Plain browser, self-hosted:** in Chromium, the File System Access API (`showSaveFilePicker`) saves `manifest.json` straight to a chosen file and remembers the handle for later saves. Elsewhere, a normal download.
- **Inside Claude artifacts:** downloads are blocked there. Options are artifact storage (a "Saved mockups" list holding manifests, and optionally the part files, reopenable on any device; check which storage capability the account has) or keep Copy as the fallback.
- Show what happened ("Saved to manifest.json", "Downloaded", "Copied") and keep the in-browser edit memory in sync after a save.
- **Tests:** a browser test for the `--writable` round trip (edit → Save → file on disk changed), and that Save is hidden or falls back where unsupported.

## 5. Manifest editor (full-screen dialog)

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
- **Footer actions:** Apply / Close, Copy manifest, and Save once item 4 exists. The embedding API's `change` event (item 1) fires from editor changes too.
- **Same data as Arrange:** both edit one in-memory manifest and share the per-model edit memory in the browser, so switching between them never loses work.
- **Tests:** browser tests that open the editor at desktop and phone widths in both themes, reorder by drag and by keyboard, edit a spec section, and confirm Copy/Save output matches. Also an accessibility pass: focus trap in the dialog, Esc to close, labelled controls.

Supersedes the UI part of item 3 (spec and page-text editing happen here). Item 3's data rules still apply.
