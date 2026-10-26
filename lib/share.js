// Share links: a mockup's manifest and OpenSCAD sources, compressed into the URL fragment (viewer.html#m=…).
// The viewer has its own copy of the encoder and decoder (src/viewer.html, "share links"); both use raw deflate
// and base64url, so each reads the other's links. Keep the checks in step.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const SHARE_VERSION = 1;
export const SHARE_NOTE_LENGTH = 8 * 1024;     // longer links get a note: some apps cut them
export const SHARE_MAX_LENGTH = 64 * 1024;     // longer links are refused
export const SHARE_MAX_FILES = 40;
export const SHARE_MAX_BYTES = 5 * 1024 * 1024; // decompressed
export const DEFAULT_SHARE_BASE = 'https://sirmeili.github.io/3d-mockup-viewer/openscad/viewer.html';

const REFS = /\b(?:include|use)\s*<([^>]+)>|\bimport\s*\(\s*(?:file\s*=\s*)?"([^"]+)"/g;
const TEXT_IMPORTS = ['svg', 'dxf', 'off', 'obj', 'dat', 'stl'];

const fail = (message) => new Error(message);

/** payload -> base64url string (the part after #m=) */
export function encodeShare(payload) {
  return zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }).toString('base64url');
}

/** base64url string -> checked payload; throws with a message for people */
export function decodeShare(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw fail('The link is damaged: its data has characters a share link never uses.');
  if (str.length > SHARE_MAX_LENGTH) throw fail('The link is longer than share links can be.');
  let json;
  try { json = zlib.inflateRawSync(Buffer.from(str, 'base64url'), { maxOutputLength: SHARE_MAX_BYTES }).toString('utf8'); }
  catch (e) { throw fail('The link is damaged or cut short: its data could not be unpacked.'); }
  let p;
  try { p = JSON.parse(json); } catch (e) { throw fail('The link is damaged: its data is not valid.'); }
  return checkShare(p);
}

/** the payload checks the viewer makes too */
export function checkShare(p) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(p) || !Number.isInteger(p.v)) throw fail('The link is damaged: its data is not a mockup.');
  if (p.v > SHARE_VERSION) throw fail('This link was made with a newer viewer' + (p.viewer ? ' (' + p.viewer + ')' : '') + '. Open it in the latest viewer.');
  if (!isObj(p.manifest) || !Array.isArray(p.manifest.parts)) throw fail('The link is damaged: it has no manifest.');
  if (!isObj(p.sources)) throw fail('The link is damaged: it has no OpenSCAD sources.');
  const names = Object.keys(p.sources);
  if (!names.length || names.length > SHARE_MAX_FILES) throw fail('The link must hold between 1 and ' + SHARE_MAX_FILES + ' source files; it has ' + names.length + '.');
  if (names.some((n) => typeof p.sources[n] !== 'string')) throw fail('The link is damaged: a source file is not text.');
  if (typeof p.main !== 'string' || p.sources[p.main] === undefined) throw fail('The link is damaged: its main OpenSCAD file is missing.');
  if (p.values !== undefined && !isObj(p.values)) throw fail('The link is damaged: its values are not valid.');
  return p;
}

export function shareLink(base, payload) {
  const u = new URL(base);
  u.hash = '';
  return u.href + '#m=' + encodeShare(payload);
}

// a source file's text, or an error naming why it can't go in a link
function readSource(file, rel) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext !== 'scad' && !TEXT_IMPORTS.includes(ext)) throw fail(`${rel} is a binary file; share links carry text files only. Use mockup build for this model.`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = null; }
  if (text === null || (ext === 'stl' && !/^\s*solid\b/.test(text))) throw fail(`${rel} is a binary file; share links carry text files only. Use mockup build for this model.`);
  return text;
}

/**
 * Gather a share payload from a manifest whose parts all come from OpenSCAD.
 * Sources are keyed by their path relative to the manifest, as URL mode keys them; includes are followed
 * relative to the including file, then in each library folder (stored where the include resolves).
 * @param {object} o
 * @param {string} o.manifest  path to manifest.json
 * @param {string[]} [o.libs]  library folders for include/use
 * @param {string} [o.viewer]  version written into the payload
 * @returns {{payload: object, files: string[]}}
 */
export function gatherShare({ manifest: manifestPath, libs = [], viewer = null }) {
  const base = path.dirname(path.resolve(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const parts = manifest.parts || [];
  if (!parts.length) throw fail('the manifest has no parts');
  // omitted parts travel in the manifest as written; only the parts in the mockup need sources
  const kept = parts.filter((p) => !p.omit);
  if (!kept.length) throw fail('every part in the manifest has "omit": true');
  const meshes = kept.filter((p) => !p.scad || !p.scad.file);
  if (meshes.length) throw fail(`share links can only carry OpenSCAD parts; ${meshes.map((p) => p.id || p.name).join(', ')} ${meshes.length === 1 ? 'has' : 'have'} no scad source. Use mockup build for this model.`);
  const norm = (rel) => path.posix.normalize(rel.split(path.sep).join('/'));
  const sources = {};
  const queue = Array.from(new Set(kept.map((p) => norm(p.scad.file))));
  const includedAs = {}; // key -> the path as written in include/use/import, for library lookups and messages
  for (let i = 0; i < queue.length; i++) {
    const rel = queue[i];
    if (sources[rel] !== undefined) continue;
    if (Object.keys(sources).length >= SHARE_MAX_FILES) throw fail(`the model needs more than ${SHARE_MAX_FILES} files`);
    let file = path.join(base, rel);
    if (!fs.existsSync(file)) {
      const ref = includedAs[rel];
      const lib = ref && libs.map((l) => path.join(l, ref)).find((f) => fs.existsSync(f));
      if (!lib) throw fail(`${rel} is missing${ref ? ' (included as ' + ref + ')' : ''}`);
      file = lib;
    }
    sources[rel] = readSource(file, rel);
    if (!/\.scad$/i.test(rel)) continue;
    const dir = path.posix.dirname(rel);
    let m; REFS.lastIndex = 0;
    while ((m = REFS.exec(sources[rel]))) {
      const ref = m[1] || m[2];
      const key = norm(path.posix.join(dir, ref));
      if (!queue.includes(key)) { queue.push(key); includedAs[key] = ref; }
    }
  }
  const mf = JSON.parse(JSON.stringify(manifest));
  mf.parts.forEach((p) => { if (!p.omit) { p.scad = { file: norm(p.scad.file), defines: p.scad.defines || {} }; delete p.file; } });
  const payload = { v: SHARE_VERSION, viewer, manifest: mf, main: mf.parts.find((p) => !p.omit).scad.file, sources };
  return { payload, files: Object.keys(sources) };
}
