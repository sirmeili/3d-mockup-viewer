# Third-party components

This project's own code is MIT licensed (see LICENSE). The components below keep their own licenses.

| Component | Used for | License | How it is included |
|---|---|---|---|
| [three.js](https://threejs.org) r128 (core, OrbitControls, STLLoader, GLTFLoader) | 3D rendering | MIT | Loaded from cdnjs / jsDelivr at runtime |
| [fflate](https://github.com/101arrowz/fflate) 0.6.9 | Unzipping 3MF files | MIT | Loaded from jsDelivr at runtime |
| [OpenSCAD](https://openscad.org) 2025.01 WebAssembly build ([openscad-wasm-prebuilt](https://www.npmjs.com/package/openscad-wasm-prebuilt) 1.2.0) | Rendering `.scad` files in the CLI and the OpenSCAD edition | GPL-2.0-or-later | npm dependency; copied to `dist/openscad/openscad.js` with its license as `OPENSCAD-COPYING.txt` |
| [Liberation Fonts](https://github.com/liberationfonts) (Sans, Mono, Serif) | `text()` in OpenSCAD renders | SIL OFL 1.1 | `vendor/fonts/`, license in `vendor/fonts/OFL.txt` |
| Archivo, Public Sans, JetBrains Mono | Page typography | SIL OFL 1.1 | Google Fonts at runtime |
