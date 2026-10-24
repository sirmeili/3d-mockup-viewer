// Build a standalone mockup page: manifest + part files (or .scad sources) -> one HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPart } from './scad.js';
import { toBinaryStl } from './stl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.join(HERE, '..', 'src');
export const TEMPLATE = path.join(SRC_DIR, 'viewer.html');
export const SCAD_ADDON = path.join(SRC_DIR, 'scad-addon.html');

const DATA_RE = /(<script id="mockup-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const SLOT = '<!-- EDITION-SLOT -->';

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Put data (and optionally an edition add-on) into the viewer template.
 * @param {object} o
 * @param {object|null} o.data   {manifest, files: {name: base64}, dropIn, scad?} or null for an empty viewer
 * @param {string} [o.title]     page <title>
 * @param {string} [o.addon]     'openscad' or a path to an HTML fragment
 * @param {string} [o.template]  template path (default: src/viewer.html)
 */
export function renderPage({ data = null, title, addon, template = TEMPLATE }) {
  let html = fs.readFileSync(template, 'utf8');
  if (!DATA_RE.test(html)) throw new Error('template has no mockup-data tag');
  const payload = JSON.stringify(data).replace(/<\//g, '<\\/');
  html = html.replace(DATA_RE, (_m, a, _b, c) => a + payload + c);
  if (addon) {
    const file = addon === 'openscad' ? SCAD_ADDON : addon;
    if (!html.includes(SLOT)) throw new Error('template has no EDITION-SLOT marker');
    html = html.replace(SLOT, SLOT + '\n' + fs.readFileSync(file, 'utf8'));
  }
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escapeHtml(title) + '</title>');
  return html;
}

/**
 * Build a mockup page from a manifest.
 * Parts with `scad` are rendered (unless render=false, then their STL must already exist in stlDir).
 * @returns {Promise<{out: string, bytes: number, parts: number, log: string[]}>}
 */
export async function buildMockup({
  manifest: manifestPath, out, dropIn = false, embedScad = false, addon, stlDir, engine = 'wasm',
  render = true, title, eyebrow, libs = [], root, onProgress = () => {}
}) {
  const base = path.dirname(path.resolve(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (eyebrow) manifest.eyebrow = eyebrow;
  const stlOut = stlDir ? path.resolve(stlDir) : base;
  fs.mkdirSync(stlOut, { recursive: true });
  const files = {};
  const scadSources = {};
  const log = [];

  for (const p of manifest.parts || []) {
    p.id = p.id || slug(p.name || 'part');
    const scad = p.scad;
    let data;
    if (scad && render) {
      onProgress(`render ${p.id} <- ${scad.file} ${JSON.stringify(scad.defines || {})}`);
      const scadFile = path.join(base, scad.file);
      const res = await renderPart({ scadFile, defines: scad.defines || {}, rootDir: root || path.dirname(scadFile), libs, engine });
      log.push(`-- ${p.id} (${res.ms} ms)`, ...res.log);
      if (!res.stl) throw new Error(`OpenSCAD produced no geometry for part "${p.id}":\n${res.log.slice(-15).join('\n')}`);
      data = res.stl;
      // write where the manifest says (so ?manifest= loading finds it), else into stlDir
      const dest = p.file && !stlDir ? path.join(base, p.file) : path.join(stlOut, `${p.id}.stl`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      p.file = path.basename(dest);
    } else {
      const candidates = [p.file && path.join(base, p.file), p.file && path.join(stlOut, path.basename(p.file)), path.join(stlOut, `${p.id}.stl`)].filter(Boolean);
      const src = candidates.find((c) => fs.existsSync(c));
      if (!src) throw new Error(`missing file for part "${p.id}" (looked for ${candidates.join(', ')})`);
      data = fs.readFileSync(src);
      if (src.toLowerCase().endsWith('.stl')) data = toBinaryStl(data);
      p.file = path.basename(src);
    }
    files[p.file] = data.toString('base64');
    if (scad && embedScad) {
      const name = path.basename(scad.file);
      scadSources[name] = fs.readFileSync(path.join(base, scad.file), 'utf8');
      p.scad = { file: name, defines: scad.defines || {} };
    } else {
      delete p.scad;
    }
  }

  const data = { manifest, files, dropIn: !!dropIn };
  if (Object.keys(scadSources).length) data.scad = { main: Object.keys(scadSources)[0], sources: scadSources };
  const html = renderPage({ data, addon, title: title || (!dropIn && manifest.name) || undefined });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  const bytes = Buffer.byteLength(html);
  return { out, bytes, parts: Object.keys(files).length, log };
}
