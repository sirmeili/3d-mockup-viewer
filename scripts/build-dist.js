#!/usr/bin/env node
// Build everything in dist/:
//   dist/viewer.html                 empty viewer (drop-in + ?manifest= URL loading) for embedding in other projects
//   dist/demo.html                   viewer with the sample model; published as the "3D Mockup Viewer" artifact
//   dist/openscad/viewer.html        empty OpenSCAD edition
//   dist/openscad/index.html         OpenSCAD edition with the sample; published as the "OpenSCAD Mockup Viewer" artifact
//   dist/openscad/{openscad.js, scad-worker.js, fonts/, OPENSCAD-COPYING.txt}
//   dist/embed.js                    host helper for the embedding API (docs/embedding.md)
//   dist/examples/sensor-box/        manifest + STLs + .scad for URL-mode testing
//   dist/index.html                  landing page for GitHub Pages
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockup, renderPage } from '../lib/build.js';
import { writeOpenscadEdition } from '../lib/edition.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const EXAMPLE = path.join(ROOT, 'examples', 'sensor-box');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

if (process.argv.includes('--if-missing') && fs.existsSync(path.join(DIST, 'demo.html'))) process.exit(0);

const t0 = Date.now();
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'openscad'), { recursive: true });
const stamp = (html) => html.replace(/<meta name="mockup-viewer-version" content="[^"]*">/, `<meta name="mockup-viewer-version" content="${PKG.version}">`);
const write = (rel, html) => { fs.writeFileSync(path.join(DIST, rel), stamp(html)); console.log('  ' + rel); };

console.log(`building dist/ for ${PKG.name} ${PKG.version}`);

// sample STLs rendered once, reused by every page
const stlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-sample-'));
const demo = path.join(DIST, 'demo.html');
await buildMockup({ manifest: path.join(EXAMPLE, 'manifest.json'), out: demo, dropIn: true, stlDir, eyebrow: 'Sample model · load your own files', title: '3D Mockup Viewer', onProgress: (s) => console.log('  ' + s) });
fs.writeFileSync(demo, stamp(fs.readFileSync(demo, 'utf8'))); console.log('  demo.html');

const scadDemo = path.join(DIST, 'openscad', 'index.html');
await buildMockup({ manifest: path.join(EXAMPLE, 'manifest.json'), out: scadDemo, dropIn: true, stlDir, render: false, embedScad: true, addon: 'openscad', eyebrow: 'Sample model · edit values or load your own .scad', title: 'OpenSCAD Mockup Viewer' });
fs.writeFileSync(scadDemo, stamp(fs.readFileSync(scadDemo, 'utf8'))); console.log('  openscad/index.html');

write('viewer.html', renderPage({ data: null, title: '3D Mockup Viewer' }));
write('openscad/viewer.html', renderPage({ data: null, addon: 'openscad', title: 'OpenSCAD Mockup Viewer' }));
writeOpenscadEdition(path.join(DIST, 'openscad')).forEach((f) => console.log('  openscad/' + f));
fs.copyFileSync(path.join(ROOT, 'src', 'embed.js'), path.join(DIST, 'embed.js')); console.log('  embed.js');

// example folder for ?manifest= loading
const exOut = path.join(DIST, 'examples', 'sensor-box');
fs.mkdirSync(exOut, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'manifest.json'), 'utf8'));
for (const p of mf.parts) { fs.copyFileSync(path.join(stlDir, `${p.id}.stl`), path.join(exOut, `${p.id}.stl`)); p.file = `${p.id}.stl`; }
fs.writeFileSync(path.join(exOut, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
fs.copyFileSync(path.join(EXAMPLE, 'sensor_box.scad'), path.join(exOut, 'sensor_box.scad'));
console.log('  examples/sensor-box/');

fs.writeFileSync(path.join(DIST, 'index.html'), fs.readFileSync(path.join(ROOT, 'src', 'landing.html'), 'utf8').replace(/\{\{version\}\}/g, PKG.version));
console.log('  index.html');
fs.rmSync(stlDir, { recursive: true, force: true });
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
