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
