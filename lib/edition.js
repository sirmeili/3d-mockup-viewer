// Write the runtime files the OpenSCAD edition needs next to its page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SRC_DIR } from './build.js';
import { FONT_DIR } from './scad.js';

/** Folder of the openscad-wasm-prebuilt package. */
export function openscadPackageDir() {
  // the package only exports its entry (dist/openscad.js), so go up from there
  return path.dirname(path.dirname(fileURLToPath(import.meta.resolve('openscad-wasm-prebuilt'))));
}

/**
 * Copy openscad.js, the render worker and fonts into `dir` (the folder holding the OpenSCAD edition page).
 * @returns {string[]} files written, relative to dir
 */
export function writeOpenscadEdition(dir) {
  const pkg = openscadPackageDir();
  const written = [];
  const copy = (from, rel) => {
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    written.push(rel);
  };
  copy(path.join(pkg, 'dist', 'openscad.js'), 'openscad.js');
  copy(path.join(pkg, 'COPYING'), 'OPENSCAD-COPYING.txt');
  copy(path.join(SRC_DIR, 'scad-worker.js'), 'scad-worker.js');
  for (const f of fs.readdirSync(FONT_DIR)) copy(path.join(FONT_DIR, f), path.join('fonts', f));
  return written;
}
