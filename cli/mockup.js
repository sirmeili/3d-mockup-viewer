#!/usr/bin/env node
// mockup: build and serve interactive 3D mockups. Run `mockup help` for usage.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockup, renderPage } from '../lib/build.js';
import { renderPart } from '../lib/scad.js';
import { writeOpenscadEdition } from '../lib/edition.js';
import { gatherShare, shareLink, DEFAULT_SHARE_BASE, SHARE_NOTE_LENGTH, SHARE_MAX_LENGTH } from '../lib/share.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

const HELP = `mockup ${PKG.version}: interactive 3D mockups for printable enclosures

Usage
  mockup build <manifest.json> -o <out.html> [options]
      Render .scad parts (if any) and bake everything into one HTML page.
      --drop-in          keep the Load files button and drag-and-drop
      --openscad         OpenSCAD edition: embed the .scad sources so values can be edited
                         and re-rendered in the page; writes openscad.js, worker and fonts next to <out.html>
      --stl-dir <dir>    where rendered STLs go (default: each part's "file", else next to the manifest)
      --no-render        don't run OpenSCAD; use STLs already in --stl-dir
      --engine <name>    wasm (default, bundled OpenSCAD 2025) or native (openscad on PATH)
      --lib <dir>        library folder for include/use (repeatable), e.g. BOSL2
      --root <dir>       folder OpenSCAD can see (default: the .scad file's folder); widen it
                         when includes reach outside, e.g. include <../common/screws.scad>
      --title <text>     page title (default: manifest name)
      --embed-origin <origin>  let a page on this origin drive the mockup from a parent frame
                         (embedding API, repeatable), e.g. https://tracker.lan; see docs/embedding.md

  mockup init [dir] [--scad <file.scad>] [--openscad] [--embed-origin <origin>]
      Create a mockup folder (default ./mockup) with a starter manifest.json and a
      viewer.html that loads it: open viewer.html?manifest=manifest.json from any web server.
      --scad fills the parts list from the file's part selector (part == "lid" ...).

  mockup viewer <dir> [--openscad] [--embed-origin <origin>]
      Copy the empty viewer (and OpenSCAD runtime with --openscad) into <dir>. Use it to update
      the viewer in a project after upgrading this package.

  mockup link <manifest.json> [--base <url>] [--lib <dir>]
      Print a share link: the manifest and its .scad sources packed into the link itself, opened
      read-only in the OpenSCAD viewer. Nothing is uploaded. Every part must come from OpenSCAD.
      --base <url>       viewer the link opens (default: ${DEFAULT_SHARE_BASE})
      --lib <dir>        library folder for include/use (repeatable); those files go in the link too

  mockup render <file.scad> -o <out.stl> [-D name=value ...] [--engine wasm|native] [--lib <dir>]
      Render one STL.

  mockup serve [dir] [--port 8080]
      Serve a folder over http (the OpenSCAD edition needs http, not file://).
`;

function parseArgs(argv) {
  const args = { _: [], lib: [], D: [], 'embed-origin': [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '-D') args.D.push(argv[++i]);
    else if (a === '--lib') args.lib.push(argv[++i]);
    else if (a === '--embed-origin') args['embed-origin'].push(argv[++i]);
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (['stl-dir', 'engine', 'title', 'scad', 'port', 'root', 'base'].includes(key)) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function parseDefine(d) {
  const i = d.indexOf('=');
  if (i < 0) throw new Error(`-D expects name=value, got "${d}"`);
  const k = d.slice(0, i), raw = d.slice(i + 1);
  try { return [k, JSON.parse(raw)]; } catch { return [k, raw]; }
}

function detectParts(src) {
  const re = /\b([A-Za-z_]\w*)\s*==\s*"([^"]+)"/g; const seen = {}; let m;
  while ((m = re.exec(src))) {
    if (/^(all|assembly|none|everything)$/i.test(m[2])) continue;
    (seen[m[1]] ||= []).includes(m[2]) || seen[m[1]].push(m[2]);
  }
  let best = null;
  for (const v in seen) if (seen[v].length >= 2 && (!best || seen[v].length > seen[best].length)) best = v;
  return best ? { variable: best, values: seen[best] } : null;
}

const GUESS = [
  [/pcb|board/i, 'pcb-green'], [/rj45|db9|usb|jack|metal|screw/i, 'metal'], [/header|connector|terminal|button/i, 'plastic-black'],
  [/led/i, 'led'], [/pipe|lens|window|clear/i, 'clear'], [/case|base|lid|shell|top|bottom|cover|body|housing/i, 'finish']
];
const guessMaterial = (n) => (GUESS.find(([re]) => re.test(n)) || [null, 'plastic-white'])[1];
const pretty = (s) => s.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function copyViewer(dir, openscad, embedOrigins) {
  fs.mkdirSync(dir, { recursive: true });
  const html = renderPage({ data: null, addon: openscad ? 'openscad' : undefined, title: openscad ? 'OpenSCAD Mockup Viewer' : '3D Mockup Viewer', embedOrigins });
  fs.writeFileSync(path.join(dir, 'viewer.html'), html);
  const written = ['viewer.html'];
  if (openscad) written.push(...writeOpenscadEdition(dir));
  return written;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === '--version' || cmd === 'version') { console.log(PKG.version); return; }

  if (cmd === 'build') {
    const manifest = a._[0];
    if (!manifest || !a.out) throw new Error('usage: mockup build <manifest.json> -o <out.html>');
    const res = await buildMockup({
      manifest, out: a.out, dropIn: !!a['drop-in'], embedScad: !!a.openscad, addon: a.openscad ? 'openscad' : undefined,
      stlDir: a['stl-dir'], render: !a['no-render'], engine: a.engine || 'wasm', libs: a.lib, title: a.title, root: a.root,
      embedOrigins: a['embed-origin'],
      onProgress: (s) => console.log(s)
    });
    if (a.openscad) writeOpenscadEdition(path.dirname(path.resolve(a.out)));
    const mb = res.bytes / 1e6;
    console.log(`wrote ${res.out}: ${res.parts} part files, ${mb.toFixed(2)} MB`);
    if (mb > 14) console.warn('warning: over 14 MB; Claude artifacts cap pages at 16 MB. Lower $fn on small round features.');
    return;
  }

  if (cmd === 'init') {
    const dir = path.resolve(a._[0] || 'mockup');
    const mfPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(mfPath)) throw new Error(`${mfPath} already exists`);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = {
      name: path.basename(path.resolve(dir, '..')).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      subtitle: '',
      up: 'z',
      parts: [],
      groups: {},
      views: ['front', 'rear', 'left', 'top', 'iso'],
      finishes: [{ name: 'Graphite', color: '#3a3e41' }, { name: 'Bone white', color: '#e4e1d8' }],
      spec: [{ title: 'Size and fit', rows: [['Outside', 'TBD']] }]
    };
    if (a.scad) {
      const scadRel = path.relative(dir, path.resolve(a.scad)).split(path.sep).join('/');
      const found = detectParts(fs.readFileSync(a.scad, 'utf8'));
      if (found) {
        manifest.parts = found.values.map((v) => { const id = v.toLowerCase().replace(/[^a-z0-9]+/g, '-'); return { id, name: pretty(v), group: id, material: guessMaterial(v), file: `stl/${id}.stl`, scad: { file: scadRel, defines: { [found.variable]: v } } }; });
        console.log(`found ${found.values.length} parts via ${found.variable}: ${found.values.join(', ')}`);
      } else {
        manifest.parts = [{ id: 'model', name: 'Model', material: 'finish', file: 'stl/model.stl', scad: { file: scadRel, defines: {} } }];
        console.log('no part selector found; the whole file renders as one part');
      }
    }
    fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2) + '\n');
    const written = copyViewer(dir, !!a.openscad, a['embed-origin']);
    console.log(`created ${path.relative(process.cwd(), mfPath)} and ${written.length} viewer file(s) in ${path.relative(process.cwd(), dir) || '.'}`);
    const rel = path.relative(process.cwd(), dir) || '.';
    if (a.scad) console.log(`next: mockup build ${rel}/manifest.json -o ${rel}/index.html   (renders ${rel}/stl/*.stl and a single-file page)`);
    console.log(`then:  mockup serve .   and open /${rel}/viewer.html?manifest=manifest.json`);
    return;
  }

  if (cmd === 'viewer') {
    const dir = path.resolve(a._[0] || '.');
    const written = copyViewer(dir, !!a.openscad, a['embed-origin']);
    console.log(`wrote ${written.length} file(s) to ${dir}`);
    return;
  }

  if (cmd === 'link') {
    const manifest = a._[0];
    if (!manifest) throw new Error('usage: mockup link <manifest.json> [--base <url>]');
    const { payload, files } = gatherShare({ manifest, libs: a.lib, viewer: PKG.version });
    const link = shareLink(a.base || DEFAULT_SHARE_BASE, payload);
    if (link.length > SHARE_MAX_LENGTH) throw new Error(`the link would be ${(link.length / 1024).toFixed(1)} KB; share links stop at ${SHARE_MAX_LENGTH / 1024} KB. Use mockup build for this model.`);
    console.log(link);
    console.error(`${files.length} source file(s), ${(link.length / 1024).toFixed(1)} KB. Anyone with the link can read the full source.`);
    if (link.length > SHARE_NOTE_LENGTH) console.error('note: some apps cut long links; check it opens before sending.');
    return;
  }

  if (cmd === 'render') {
    const file = a._[0];
    if (!file || !a.out) throw new Error('usage: mockup render <file.scad> -o <out.stl>');
    const res = await renderPart({ scadFile: file, defines: Object.fromEntries(a.D.map(parseDefine)), libs: a.lib, engine: a.engine || 'wasm' });
    if (!res.stl) { console.error(res.log.join('\n')); throw new Error('OpenSCAD produced no geometry'); }
    fs.writeFileSync(a.out, res.stl);
    console.log(`wrote ${a.out} (${res.ms} ms)`);
    return;
  }

  if (cmd === 'serve') {
    const root = path.resolve(a._[0] || '.');
    const port = +(a.port || 8080);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.stl': 'model/stl', '.3mf': 'model/3mf', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.scad': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(root, url);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(port, () => console.log(`serving ${root} at http://localhost:${port}/`));
    return;
  }

  throw new Error(`unknown command "${cmd}". Run mockup help.`);
}

main().catch((e) => { console.error('mockup: ' + (e && e.message ? e.message : e)); process.exit(1); });
