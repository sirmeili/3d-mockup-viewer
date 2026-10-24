// Render OpenSCAD parts to binary STL, with the bundled WebAssembly build (default) or a native `openscad`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.join(HERE, '..', 'vendor', 'fonts');
const INCLUDE_EXT = new Set(['.scad', '.stl', '.svg', '.dxf', '.dat', '.png', '.csv', '.off', '.obj', '.3mf', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', 'build']);
const MAX_BYTES = 60 * 1024 * 1024;

/** Turn a JS value into an OpenSCAD literal for -D. */
export function scadLiteral(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(scadLiteral).join(', ') + ']';
  return String(v);
}

function collect(dir, base = dir, out = [], budget = { bytes: 0 }, depth = 0) {
  if (depth > 5) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) collect(full, base, out, budget, depth + 1); continue; }
    if (!INCLUDE_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const size = fs.statSync(full).size;
    if (budget.bytes + size > MAX_BYTES) continue;
    budget.bytes += size;
    out.push({ rel: path.relative(base, full).split(path.sep).join('/'), full });
  }
  return out;
}

let wasmModule = null;
async function loadWasm() {
  if (!wasmModule) wasmModule = await import('openscad-wasm-prebuilt');
  return wasmModule;
}

function mkdirp(FS, p) {
  let cur = '';
  for (const part of p.split('/').filter(Boolean)) { cur += '/' + part; try { FS.mkdir(cur); } catch { /* exists */ } }
}

/**
 * Render one part.
 * @param {object} o
 * @param {string} o.scadFile   path to the .scad file
 * @param {object} [o.defines]  {name: value} passed as -D
 * @param {string} [o.rootDir]  folder made visible to OpenSCAD (default: the .scad file's folder)
 * @param {string[]} [o.libs]   extra library folders, searched via OPENSCADPATH (e.g. BOSL2)
 * @param {'wasm'|'native'} [o.engine]
 * @returns {Promise<{stl: Buffer|null, log: string[], ms: number}>}
 */
export async function renderPart({ scadFile, defines = {}, rootDir, libs = [], engine = 'wasm' }) {
  const root = path.resolve(rootDir || path.dirname(scadFile));
  const t0 = Date.now();
  if (engine === 'native') return renderNative({ scadFile, defines, libs, t0 });

  const { createOpenSCAD } = await loadWasm();
  const run = async (manifold) => {
    const log = [];
    const o = await createOpenSCAD({ noInitialRun: true, print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const inst = o.getInstance();
    const FS = inst.FS;
    mkdirp(FS, '/fonts');
    for (const f of fs.readdirSync(FONT_DIR)) if (f.endsWith('.ttf')) FS.writeFile('/fonts/' + f, fs.readFileSync(path.join(FONT_DIR, f)));
    FS.writeFile('/fonts/fonts.conf', '<?xml version="1.0"?><fontconfig><dir>/fonts</dir></fontconfig>');
    inst.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf';
    for (const f of collect(root)) { const dest = '/work/' + f.rel; mkdirp(FS, path.posix.dirname(dest)); FS.writeFile(dest, fs.readFileSync(f.full)); }
    const libPaths = [];
    libs.forEach((lib, i) => {
      const mount = '/libs/' + i;
      for (const f of collect(path.resolve(lib))) { const dest = mount + '/' + f.rel; mkdirp(FS, path.posix.dirname(dest)); FS.writeFile(dest, fs.readFileSync(f.full)); }
      libPaths.push(mount);
    });
    if (libPaths.length) inst.ENV.OPENSCADPATH = libPaths.join(':');
    const rel = path.relative(root, path.resolve(scadFile)).split(path.sep).join('/');
    const args = ['/work/' + rel];
    for (const [k, v] of Object.entries(defines)) args.push('-D', `${k}=${scadLiteral(v)}`);
    if (manifold) args.push('--backend=manifold');
    args.push('--export-format', 'binstl', '-o', '/out.stl');
    try { inst.callMain(args); } catch (e) { log.push('ERROR: ' + (e && e.message ? e.message : String(e))); }
    let stl = null;
    try { const d = FS.readFile('/out.stl'); if (d.length > 84) stl = Buffer.from(d); } catch { /* no output */ }
    return { stl, log };
  };
  let res = await run(true);
  if (!res.stl) { const retry = await run(false); res = { stl: retry.stl, log: res.log.concat(['-- retry with the classic geometry engine --'], retry.log) }; }
  return { ...res, ms: Date.now() - t0 };
}

function renderNative({ scadFile, defines, libs, t0 }) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-')), 'out.stl');
  const args = ['-o', out, '--export-format', 'binstl'];
  for (const [k, v] of Object.entries(defines)) args.push('-D', `${k}=${scadLiteral(v)}`);
  args.push(scadFile);
  const env = { ...process.env };
  if (libs.length) env.OPENSCADPATH = [...libs.map((l) => path.resolve(l)), env.OPENSCADPATH].filter(Boolean).join(path.delimiter);
  const r = spawnSync('openscad', args, { encoding: 'utf8', env });
  if (r.error) throw new Error('native openscad not found; install it or use the default wasm engine');
  const log = (r.stderr || '').split('\n').filter(Boolean);
  const stl = fs.existsSync(out) ? fs.readFileSync(out) : null;
  return { stl: stl && stl.length > 84 ? stl : null, log, ms: Date.now() - t0 };
}
