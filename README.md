# 3D Mockup Viewer

Interactive mockups for 3D-printed enclosures. Load STL, 3MF, GLB or OpenSCAD parts and get:

- **Assembled, Exploded and See-inside views**, camera presets, finish swatches and a spec sheet
- **Section cuts** along X, Y or Z for checking clearances
- **Arrange**: set groups, explode offsets, materials and names visually, then copy the manifest
- **OpenSCAD edition**: renders `.scad` files in the browser and turns top-level values into editable fields

Everything runs in the browser. A finished mockup is a single HTML file you can open, share or host anywhere.

## Pieces

| Output | What it is |
|---|---|
| `dist/viewer.html` | Empty viewer. Drop files on it, or load `viewer.html?manifest=path/to/manifest.json` from the same site. |
| `dist/openscad/` | The same viewer with OpenSCAD built in (`viewer.html`, plus `openscad.js`, the render worker and fonts). Needs http, not `file://`. |
| `dist/demo.html`, `dist/openscad/index.html` | Both viewers with a sample model. These are what the Claude artifacts publish. |
| `mockup` CLI | Builds single-file mockups from a manifest, renders `.scad` parts with the bundled OpenSCAD, copies the viewer into other projects. |

`npm run build` produces `dist/`. It is not committed.

## Use it in another project

Install straight from GitHub at a tagged version (no npm registry needed):

```sh
npm install --save-dev github:sirmeili/3d-mockup-viewer#v0.1.0
```

Then, in that project:

```sh
npx mockup init mockup --scad hardware/case.scad    # mockup/manifest.json + mockup/viewer.html
npx mockup build mockup/manifest.json -o mockup/index.html    # also writes mockup/stl/*.stl
npx mockup serve mockup                              # http://localhost:8080/viewer.html?manifest=manifest.json
```

- `mockup/index.html` is a self-contained page with every part baked in. Commit it, attach it, or publish it as an artifact.
- `mockup/viewer.html?manifest=manifest.json` loads the manifest and part files live. Use it when the project already serves files, such as a project tracker.
- `--openscad` on `init`, `build` or `viewer` uses the OpenSCAD edition, so values can be edited and re-rendered in the page. Live loading renders any part whose STL is missing, straight from the `.scad` file. Serve from the project root (`npx mockup serve .`, then open `/mockup/viewer.html?manifest=manifest.json`) so the page can reach the `.scad` file.

To upgrade: change the tag in `package.json`, reinstall, then run `npx mockup viewer mockup` to refresh the copied viewer.

Projects without Node can download `mockup-viewer-dist.zip` from a [release](https://github.com/sirmeili/3d-mockup-viewer/releases) and copy what they need.

## CLI

```
mockup build <manifest.json> -o <out.html> [--drop-in] [--openscad] [--stl-dir dir] [--no-render]
                                           [--engine wasm|native] [--lib dir] [--title text]
mockup init [dir] [--scad file.scad] [--openscad]
mockup viewer <dir> [--openscad]
mockup render <file.scad> -o <out.stl> [-D name=value ...]
mockup serve [dir] [--port 8080]
```

OpenSCAD rendering uses the bundled WebAssembly build (OpenSCAD 2025 with the Manifold engine), so nothing needs installing. `--engine native` uses `openscad` on your PATH instead. `--lib` makes a library folder such as BOSL2 available to `include`/`use`.

The manifest format is in [docs/manifest.md](docs/manifest.md).

## Develop

```sh
npm install        # also builds dist/
npm test
npm run build
npx playwright install chromium   # once
npm run test:browser              # about 6 minutes; screenshots in test-results/
npm run serve      # http://localhost:8080/
```

Source lives in `src/`: `viewer.html` (the viewer and its template), `scad-addon.html` (the OpenSCAD edition's panel, inserted at the `EDITION-SLOT` marker), `scad-worker.js` (renders in a Web Worker). See [CLAUDE.md](CLAUDE.md) for how the pieces fit and how releases and the Claude artifacts are updated.

## Roadmap

Planned work is tracked in [TODO.md](TODO.md).

## How this was built

This project was built with [Claude](https://claude.ai) (Anthropic) as an engineering collaborator, directed by Frank M Thompson. It follows agentic engineering practices rather than unreviewed generation:

- **Human-directed design.** Requirements, scope and every design decision came from the maintainer and were refined over several review rounds. Examples include the Arrange editor, collapsible parameters, field labels, the split into a light viewer and an OpenSCAD edition, and the licensing.
- **Tested, not assumed.** `npm test` covers building, OpenSCAD rendering, fonts and STL handling. `npm run test:browser` loads every built page in headless Chromium at desktop and phone widths, in light and dark mode. It checks that the model is actually drawn, nothing errors or scrolls sideways, the exploded, see-inside, section and Arrange views work, and the OpenSCAD edition re-renders all parts after a value changes.
- **Continuous integration.** Every push runs both test suites and a full build on GitHub Actions, and keeps the screenshots for review. A release is only published if they pass. Releases are tagged versions, so other projects pin exactly what they use.
- **Documented for humans and agents.** [docs/manifest.md](docs/manifest.md) specifies the data format. [CLAUDE.md](CLAUDE.md) records the architecture, constraints and release steps so future sessions work from the same ground truth instead of guessing.
- **Pinned dependencies and tracked licences.** Runtime libraries are pinned to exact versions, and third-party licences are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
- **Traceable history.** Commits written with Claude carry a `Co-Authored-By: Claude` trailer.

## License

[MIT](LICENSE) for this project's own code.

Third-party components keep their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). The OpenSCAD WebAssembly build that powers the OpenSCAD edition and the CLI's `.scad` rendering is GPL-2.0-or-later. The plain viewer and pages built without `--openscad` don't include it. If you hand the OpenSCAD edition (`dist/openscad/`, or a page built with `--openscad`) to other people, treat that bundle as GPL: keep `OPENSCAD-COPYING.txt` with it and point to the [OpenSCAD source](https://github.com/openscad/openscad).
