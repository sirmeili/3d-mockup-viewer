// Host-side helper: put the 3D Mockup Viewer in an iframe and drive it with messages. See docs/embedding.md.
//   import { embedViewer } from '3d-mockup-viewer/embed';
//   const viewer = embedViewer(el, { src: '/mockup/viewer.html' });
//   await viewer.load('/mockup/manifest.json');
//   viewer.on('change', ({ manifest }) => save(manifest));
export const PROTOCOL = 'mockup-viewer';
export const PROTOCOL_VERSION = 1;
const EVENTS = ['ready', 'loaded', 'change', 'error'];

/**
 * @param {Element} el  container; the iframe fills its width
 * @param {object} opts
 * @param {string} opts.src                viewer page URL (viewer.html, or openscad/viewer.html for the OpenSCAD edition)
 * @param {string} [opts.height='600px']   iframe height
 * @param {string} [opts.title]            iframe title for screen readers
 * @param {boolean} [opts.addParent=true]  add ?parent=<this origin> to src; set false when the viewer was built with --embed-origin
 * @param {number} [opts.timeout=30000]    ms to wait for the viewer's ready message
 */
export function embedViewer(el, opts = {}) {
  if (!opts.src) throw new Error('embedViewer needs opts.src, the viewer page URL');
  const url = new URL(opts.src, document.baseURI);
  if (opts.addParent !== false) url.searchParams.set('parent', location.origin);
  const viewerOrigin = url.origin;

  const iframe = document.createElement('iframe');
  iframe.src = url.href;
  iframe.title = opts.title || '3D model viewer';
  iframe.style.cssText = 'display:block;width:100%;border:0;height:' + (opts.height || '600px');
  el.appendChild(iframe);

  const listeners = {}; EVENTS.forEach((t) => { listeners[t] = new Set(); });
  const pending = new Map();
  let nextId = 1, destroyed = false, readyInfo = null;
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {}); // callers that never await ready shouldn't see an unhandled rejection
  const timer = setTimeout(() => rejectReady(coded('timeout', 'The viewer did not answer within ' + (opts.timeout || 30000) + ' ms. Check src, and that this origin is allowed (?parent= or --embed-origin).')), opts.timeout || 30000);

  function coded(code, message, extra) { return Object.assign(new Error(message), { code }, extra); }
  function emit(type, data) { listeners[type].forEach((fn) => { try { fn(data); } catch (e) { setTimeout(() => { throw e; }); } }); }

  function onMessage(e) {
    if (e.source !== iframe.contentWindow || e.origin !== viewerOrigin) return;
    const m = e.data;
    if (!m || m.protocol !== PROTOCOL) return;
    if (m.version !== PROTOCOL_VERSION) {
      rejectReady(coded('version', 'The viewer speaks protocol version ' + m.version + '; this helper speaks ' + PROTOCOL_VERSION + '.'));
      return;
    }
    if (m.type === 'reply') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(coded(m.error.code, m.error.message, { warnings: m.error.warnings }));
      return;
    }
    if (m.type === 'ready') { clearTimeout(timer); readyInfo = strip(m); resolveReady(readyInfo); }
    if (EVENTS.includes(m.type)) emit(m.type, strip(m));
  }
  function strip(m) { const o = Object.assign({}, m); delete o.protocol; delete o.version; delete o.type; return o; }
  window.addEventListener('message', onMessage);

  async function send(type, body = {}, transfer = []) {
    await ready;
    if (destroyed) throw coded('destroyed', 'The viewer was removed.');
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      iframe.contentWindow.postMessage(Object.assign({}, body, { protocol: PROTOCOL, version: PROTOCOL_VERSION, id, type }), viewerOrigin, transfer);
    });
  }
  const abs = (u) => new URL(u, document.baseURI).href;

  return {
    iframe,
    ready,
    get info() { return readyInfo; },
    /**
     * Load a model. Either a manifest URL (the viewer fetches the part files next to it), or
     * {manifest, files, base}: manifest is an object or URL; files maps file names to ArrayBuffers
     * (transferred, so the host's copy is emptied), typed arrays (copied) or URLs. Relative URLs resolve
     * against this page. Resolves with {parts, groups, size, units, warnings}.
     */
    load(spec) {
      if (typeof spec === 'string') return send('load', { manifest: abs(spec) });
      const body = { manifest: typeof spec.manifest === 'string' ? abs(spec.manifest) : (spec.manifest || null) };
      if (spec.base) body.base = abs(spec.base);
      const transfer = [];
      if (spec.files) {
        body.files = {};
        for (const [name, v] of Object.entries(spec.files)) {
          if (typeof v === 'string') body.files[name] = abs(v);
          else if (v instanceof ArrayBuffer) { body.files[name] = v; if (!transfer.includes(v)) transfer.push(v); }
          else body.files[name] = v;
        }
      }
      return send('load', body, transfer);
    },
    setMode(mode) { return send('setMode', { mode }); },
    setView(view) { return send('setView', { view }); },
    setFinish(finish) { return send('setFinish', { finish }); },
    setCut(axis, position) { return send('setCut', position === undefined ? { axis } : { axis, position }); },
    setArrange(on) { return send('setArrange', { on: !!on }); },
    getManifest() { return send('getManifest').then((r) => r.manifest); },
    /** A still of the current view: {image: JPEG data URL, width, height} in device pixels. */
    snapshot() { return send('snapshot'); },
    scad: {
      setValues(values) { return send('scad.setValues', { values }); },
      render() { return send('scad.render'); }
    },
    send,
    on(type, fn) {
      if (!listeners[type]) throw new Error('unknown event "' + type + '"; use one of ' + EVENTS.join(', '));
      listeners[type].add(fn);
      return () => listeners[type].delete(fn);
    },
    off(type, fn) { if (listeners[type]) listeners[type].delete(fn); },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      pending.forEach((p) => p.reject(coded('destroyed', 'The viewer was removed.')));
      pending.clear();
      rejectReady(coded('destroyed', 'The viewer was removed.'));
      iframe.remove();
    }
  };
}
