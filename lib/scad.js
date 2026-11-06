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

// OpenSCAD literal values: numbers, "strings", true, false, undef (null) and [lists] of those, nested.
// The viewer keeps its own copy ("OpenSCAD values" in src/viewer.html); keep the two in step.
const SCAD_ESC = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
const SCAD_HEX = { x: 2, u: 4, U: 6 };
const SCAD_ONLY = 'Only numbers, "text", true, false, undef and [lists] here.';

/** Turn a JS value into an OpenSCAD literal for -D. null and undefined become undef. */
export function scadLiteral(v) {
  if (v === null || v === undefined) return 'undef';
  if (typeof v === 'string') {
    return '"' + v.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
      .replace(/[\x00-\x1f\x7f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '"';
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(scadLiteral).join(', ') + ']';
  return String(v);
}

/**
 * Read one OpenSCAD literal starting at text[i], without evaluating anything.
 * @returns {{value: *, end: number} | {error: string}} undef reads as null; error is a message for people
 */
export function readScadValue(text, i = 0) {
  const fail = (error) => { throw { scadError: error }; };
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function value(depth) {
    ws();
    const c = text[i];
    if (c === undefined) fail(depth ? 'Missing ].' : 'Enter a value.');
    if (c === '[') {
      i++; ws();
      const out = [];
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value(depth + 1));
        ws();
        const d = text[i];
        if (d === ']') { i++; return out; }
        if (d === ',') { i++; ws(); if (text[i] === ']') fail('No comma before ].'); continue; }
        if (d === undefined) fail('Missing ].');
        if (d === ':') fail('Ranges like [0:10] can’t be edited here.');
        fail(/[[".\dA-Za-z_]/.test(d) ? 'Missing , between items.' : SCAD_ONLY);
      }
    }
    if (c === '"') {
      i++;
      let s = '';
      for (;;) {
        const d = text[i++];
        if (d === undefined || d === '\n') fail('Missing closing ".');
        if (d === '"') return s;
        if (d !== '\\') { s += d; continue; }
        const e = text[i++];
        if (SCAD_ESC[e] !== undefined) { s += SCAD_ESC[e]; continue; }
        const n = SCAD_HEX[e];
        const h = n ? text.slice(i, i + n) : '';
        const cp = n && new RegExp('^[0-9a-fA-F]{' + n + '}$').test(h) ? parseInt(h, 16) : -1;
        if (cp < 1 || cp > (e === 'x' ? 0x7f : 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) fail('Unknown escape \\' + (e || '') + h + ' in text.');
        s += String.fromCodePoint(cp); i += n;
      }
    }
    const num = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/iy;
    num.lastIndex = i;
    let m = num.exec(text);
    if (m) {
      if (/[\w.$]/.test(text[i + m[0].length] || '')) fail(SCAD_ONLY);
      const v = Number(m[0]);
      if (!Number.isFinite(v)) fail('That number is too large.');
      i += m[0].length;
      return v;
    }
    const word = /[A-Za-z_$][\w$]*/y;
    word.lastIndex = i;
    m = word.exec(text);
    const known = { true: true, false: false, undef: null };
    if (m && Object.prototype.hasOwnProperty.call(known, m[0])) { i += m[0].length; return known[m[0]]; }
    return fail(SCAD_ONLY);
  }
  try {
    const v = value(0);
    return { value: v, end: i };
  } catch (e) {
    if (e && e.scadError) return { error: e.scadError };
    throw e;
  }
}

/** Read text that must be exactly one OpenSCAD literal: {value} or {error}. */
export function parseScadValue(text) {
  const r = readScadValue(text, 0);
  if (r.error) return r;
  if (text.slice(r.end).trim()) return { error: SCAD_ONLY };
  return { value: r.value };
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
