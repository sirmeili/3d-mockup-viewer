// OpenSCAD render worker for the OpenSCAD edition of the 3D Mockup Viewer.
// Runs as a module worker; the page can also import renderJob() directly if workers are unavailable.
// Each job gets a fresh OpenSCAD instance because the WASM build only supports one callMain per instance.
import { createOpenSCAD } from './openscad.js';

const FONTS = [
  'LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf', 'LiberationMono-Regular.ttf', 'LiberationSerif-Regular.ttf'
];
const FONT_CONF = '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/fonts</dir><cachedir>/tmp/fontcache</cachedir></fontconfig>';
let fontPromise = null;

function loadFonts(base) {
  if (!fontPromise) {
    fontPromise = Promise.all(FONTS.map((f) =>
      fetch(new URL('fonts/' + f, base)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
        .then((b) => [f, b ? new Uint8Array(b) : null])
    ));
  }
  return fontPromise;
}

function mkdirp(FS, path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) { cur += '/' + p; try { FS.mkdir(cur); } catch (e) { /* exists */ } }
}

// job: { files: {relativePath: string|Uint8Array}, main, defines: {name: scadLiteral}, manifold }
export async function renderJob(job, base) {
  const log = [];
  const fonts = await loadFonts(base || self.location.href);
  const o = await createOpenSCAD({ noInitialRun: true, print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const inst = o.getInstance();
  const FS = inst.FS;
  mkdirp(FS, '/fonts'); mkdirp(FS, '/tmp/fontcache');
  for (const [name, data] of fonts) if (data) FS.writeFile('/fonts/' + name, data);
  FS.writeFile('/fonts/fonts.conf', FONT_CONF);
  if (inst.ENV) { inst.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; inst.ENV.FONTCONFIG_PATH = '/fonts'; }
  for (const [path, data] of Object.entries(job.files)) {
    const full = '/work/' + path.replace(/^\/+/, '');
    mkdirp(FS, full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, data);
  }
  const args = ['/work/' + job.main];
  for (const [k, v] of Object.entries(job.defines || {})) args.push('-D', k + '=' + v);
  if (job.manifold !== false) args.push('--backend=manifold');
  args.push('--export-format', 'binstl', '-o', '/out.stl');
  const t0 = Date.now();
  let rc;
  try { rc = inst.callMain(args); } catch (e) { rc = (e && e.status !== undefined) ? e.status : -1; log.push('ERROR: ' + (e && e.message ? e.message : String(e))); }
  let stl = null;
  try { stl = FS.readFile('/out.stl'); } catch (e) { /* no output */ }
  return { rc, ms: Date.now() - t0, stl: stl && stl.length > 84 ? stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) : null, log };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async (e) => {
    const { id, job } = e.data;
    try {
      const res = await renderJob(job);
      self.postMessage({ id, ok: true, ...res }, res.stl ? [res.stl] : []);
    } catch (err) {
      self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
  };
  self.postMessage({ ready: true });
}
