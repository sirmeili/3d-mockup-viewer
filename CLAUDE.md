# 3D Mockup Viewer: notes for Claude

Interactive 3D mockups for 3D-printed enclosures. One viewer page (three.js), an optional OpenSCAD add-on, and a Node CLI that bakes mockups into single HTML files. The owner uses it for hardware projects (ESP32 enclosures designed in OpenSCAD) and embeds it in other repos.

## Layout

- `src/viewer.html`: the viewer **and** the template. Plain HTML fragment (no doctype/head/body). Claude artifacts wrap it in a skeleton at publish time, so keep it that way. Two markers matter:
  - `<script id="mockup-data" type="application/json">null</script>`: the build replaces `null` with `{manifest, files: {name: base64}, dropIn, scad?}`.
  - `<!-- EDITION-SLOT -->`: edition add-ons are inserted here.
  - It exposes `window.mockupViewer` (buildModel, warn, setLoading…) and calls `window.mockupScad` hooks if present.
- `src/scad-addon.html`: OpenSCAD edition panel: parameter parsing, part-selector detection, worker pool, re-render. Defines `window.mockupScad` (`init`, `loadFiles`, `loadSources`, `partScad`).
- `src/scad-worker.js`: module worker that imports `./openscad.js`. A fresh OpenSCAD instance per job (the WASM build only allows one `callMain` per instance). Renders with `--backend=manifold`, retries once with the classic engine.
- `src/landing.html`: GitHub Pages index.
- `lib/`: Node library (`build.js` page building, `scad.js` rendering via `openscad-wasm-prebuilt`, `edition.js` OpenSCAD runtime files, `stl.js`).
- `cli/mockup.js`: the `mockup` command.
- `scripts/build-dist.js`: builds `dist/` (not committed).
- `examples/sensor-box/`: sample model, used by the demos and tests.
- `vendor/fonts/`: Liberation fonts for OpenSCAD `text()`.

## Commands

```sh
npm install          # installs openscad-wasm-prebuilt and builds dist/
npm test             # node:test, about 2 s
npm run build        # rebuild dist/
node cli/mockup.js serve dist --port 8080
```

After changing the viewer, check it in a real browser: `npm run build`, serve `dist/`, then open `demo.html`, `openscad/index.html` and `viewer.html?manifest=examples/sensor-box/manifest.json`. Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL. Check phone width (about 400 px) and dark mode too.

## Rules for the viewer page

These come from where it is published (Claude artifacts). Breaking them fails silently.
- External scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com, pinned to exact versions. Stylesheets only from Google Fonts. Everything else inline.
- No `alert`/`confirm`/`prompt`, no `window.print`, no `<a download>` (downloads are blocked). Clipboard writes must happen in the click handler and need a fallback (see `copyManifest`).
- Colours are CSS tokens on `:root` with dark-mode overrides under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`. No literal colours in components.
- Must work at about 400 px wide with no horizontal page scroll. Side gutters use `max(16px, env(safe-area-inset-left, 0px))`.
- `localStorage` is only for per-viewer conveniences (Arrange edits, open sections), always wrapped in try/catch.
- `fetch` of relative files works when hosted (the OpenSCAD edition fetches `openscad.js`, `scad-worker.js` and `fonts/`). Query strings do not reach the page inside Claude artifacts, so `?manifest=` is for self-hosting only.
- Three.js materials use linear colour: convert sRGB hex with `convertSRGBToLinear()` (`lin()` helper).

## Releasing

1. Bump `version` in `package.json`, commit.
2. `git tag vX.Y.Z && git push --tags`. The release workflow runs the tests, builds `dist/`, attaches `mockup-viewer-dist.zip` and deploys `dist/` to GitHub Pages.
3. Other projects upgrade by changing `github:sirmeili/3d-mockup-viewer#vX.Y.Z` in their package.json.
4. Update the Claude artifacts (below).

## Updating the Claude artifacts

Two published artifacts track this repo. Use the Artifact tool, which is only available in claude.ai-connected sessions. From a new conversation, first `read` each artifact by URL, then publish with `url` so the link stays the same.

| Artifact | URL | Page | Supporting files (published path ← local file) |
|---|---|---|---|
| 3D Mockup Viewer | https://claude.ai/artifact/RsY2kjBMdZBnjXhumVscDc | `dist/demo.html` | none needed |
| OpenSCAD Mockup Viewer | https://claude.ai/artifact/DrzibhxpTdAZxWTVmgWZ6D | `dist/openscad/index.html` | `openscad.js`, `scad-worker.js` (contentType `text/javascript`), `fonts/*.ttf` (`font/ttf`), `OPENSCAD-COPYING.txt` (`text/plain`), all from `dist/openscad/` |

Steps: `npm run build`, then publish each page with its `files` map. Files left out of a publish are kept, so only re-send ones that changed. `openscad.js` (11 MB) only changes when the `openscad-wasm-prebuilt` version changes.

The owner's `enclosure-mockup` skill builds per-project mockups with this package's CLI (`npx github:sirmeili/3d-mockup-viewer#<tag> build …`). Keep the CLI flags backward compatible, or update that skill too.
