// Host-side helper: put the 3D Mockup Viewer in an iframe and drive it with messages, and the <mockup-embed>
// element for a small display-only view. See docs/embedding.md.
//   import { embedViewer } from '3d-mockup-viewer/embed';
//   const viewer = embedViewer(el, { src: '/mockup/viewer.html' });
//   await viewer.load('/mockup/manifest.json');
//   viewer.on('change', ({ manifest }) => save(manifest));
// The build also writes this file as a classic script (dist/embed.js, exposing window.mockupViewer); the module is
// dist/embed.mjs. Keep to syntax the conversion handles: top-level `export const|function|class`, and import.meta.url.
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

// ---------- <mockup-embed>: a small, display-only model view, placed like an image ----------
//   <mockup-embed src="mockup/manifest.json" height="320" controls="show,view,finish" link></mockup-embed>
// It shows the viewer's compact mode (viewer.html?embed) in an iframe. Browsers cap live 3D views (WebGL contexts)
// at roughly 16 per page, so an embed starts its 3D view only when it nears the viewport, keeps a still of it,
// and swaps back to the still when it is far away; at most MAX_LIVE are live at once.
const SCRIPT_URL = import.meta.url;
const MAX_LIVE = 8;
const NEAR = '200px 0px', FAR = '1200px 0px';
const liveEmbeds = new Set();
let nearObserver = null, farObserver = null;
function embedObservers() {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver((entries) => entries.forEach((e) => {
      e.target.near = e.isIntersecting;
      if (e.isIntersecting && e.target.getAttribute('load') !== 'click') e.target.start();
    }), { rootMargin: NEAR });
    farObserver = new IntersectionObserver((entries) => entries.forEach((e) => { if (!e.isIntersecting) e.target.release(); }), { rootMargin: FAR });
  }
  return [nearObserver, farObserver];
}
// over the limit: release the live embed farthest from the middle of the viewport
function makeRoomFor(embed) {
  if (liveEmbeds.size < MAX_LIVE) return;
  let far = null, farDist = -1;
  liveEmbeds.forEach((e) => {
    if (e === embed) return;
    const r = e.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2);
    if (d > farDist) { farDist = d; far = e; }
  });
  if (far) far.release();
}

const EMBED_STYLE = `
:host { display: block; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  --me-bg: #e6eae9; --me-bg2: #d3d9d8; --me-fg: #1b2122; --me-accent: #1f6f8b; --me-warn: #9a5b00; }
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) { --me-bg: #20272a; --me-bg2: #151a1c; --me-fg: #e4e9e8; --me-accent: #5fb3cf; --me-warn: #e2a64b; }
}
:host([theme="dark"]) { --me-bg: #20272a; --me-bg2: #151a1c; --me-fg: #e4e9e8; --me-accent: #5fb3cf; --me-warn: #e2a64b; }
[hidden] { display: none !important; }
.frame { position: relative; height: var(--h, 320px); border-radius: 10px; overflow: hidden; background: radial-gradient(120% 90% at 50% 30%, var(--me-bg), var(--me-bg2)); }
.slot, .slot iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
.cover { position: absolute; inset: 0; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; color: var(--me-fg); font: inherit; cursor: pointer; display: grid; place-items: center; }
.cover:focus-visible { outline: 2px solid var(--me-accent); outline-offset: -2px; }
.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: top center; }
.badge { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13px;
  background: color-mix(in srgb, var(--me-bg) 88%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--me-fg) 18%, transparent); }
.badge svg { width: 14px; height: 14px; fill: currentColor; }
.cover.error { cursor: default; }
.cover.error .badge { color: var(--me-warn); border-radius: 10px; max-width: 80%; text-align: center; }
.open { display: inline-block; margin-top: 6px; color: var(--me-accent); font-size: 13px; }
`;

export function defineMockupEmbed() {
  if (typeof window === 'undefined' || !window.customElements || window.customElements.get('mockup-embed')) return;
  class MockupEmbed extends HTMLElement {
    static get observedAttributes() { return ['src', 'height', 'controls', 'view', 'mode', 'finish', 'link', 'viewer', 'theme', 'load', 'title']; }
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + EMBED_STYLE + '</style><div class="frame" part="frame"><div class="slot"></div>' +
        '<button class="cover" type="button"><img alt="" hidden><span class="badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span class="label">Show 3D view</span></span></button>' +
        '</div><a class="open" part="link" target="_blank" rel="noopener" hidden>Open full viewer</a>';
      this.frameEl = root.querySelector('.frame');
      this.slotEl = root.querySelector('.slot');
      this.cover = root.querySelector('.cover');
      this.still = root.querySelector('img');
      this.label = root.querySelector('.label');
      this.linkEl = root.querySelector('.open');
      this.cover.addEventListener('click', () => { if (!this.cover.classList.contains('error')) this.start(); });
      this.viewer = null; this.stillUrl = null; this.near = false;
    }
    connectedCallback() {
      this.layout();
      if (!this.viewer) this.showCover('Show 3D view', 'still');
      if (!('IntersectionObserver' in window)) { this.start(); return; } // no way to tell what is near: just start
      embedObservers().forEach((o) => o.observe(this));
    }
    disconnectedCallback() {
      if ('IntersectionObserver' in window) embedObservers().forEach((o) => o.unobserve(this));
      this.release(false);
    }
    attributeChangedCallback(name, before, now) {
      if (!this.isConnected || before === now) return;
      this.layout();
      if (['height', 'link', 'title'].includes(name)) return;
      // anything that changes what is shown: drop the still and, if live, start again
      this.stillUrl = null;
      const wasLive = !!this.viewer;
      this.release(false);
      if (wasLive || (this.near && this.getAttribute('load') !== 'click')) this.start();
    }
    abs(u) { return new URL(u, document.baseURI).href; }
    viewerUrl() { return this.getAttribute('viewer') ? this.abs(this.getAttribute('viewer')) : new URL('viewer.html', SCRIPT_URL).href; }
    frameUrl() {
      const u = new URL(this.viewerUrl());
      u.searchParams.set('embed', '');
      u.searchParams.set('manifest', this.abs(this.getAttribute('src')));
      ['controls', 'view', 'mode', 'finish', 'theme'].forEach((k) => { const v = this.getAttribute(k); if (v) u.searchParams.set(k, v); });
      return u.href;
    }
    layout() {
      const h = this.getAttribute('height') || '320';
      this.frameEl.style.setProperty('--h', /^\d+(\.\d+)?$/.test(h) ? h + 'px' : h);
      this.cover.setAttribute('aria-label', 'Show the 3D view: ' + (this.getAttribute('title') || '3D model'));
      const link = this.getAttribute('link');
      this.linkEl.hidden = link === null || !this.getAttribute('src');
      if (!this.linkEl.hidden) {
        const full = new URL(this.viewerUrl());
        full.searchParams.set('manifest', this.abs(this.getAttribute('src')));
        this.linkEl.href = link ? this.abs(link) : full.href;
      }
    }
    showCover(text, state) {
      this.cover.hidden = false;
      this.cover.classList.toggle('error', state === 'error');
      this.still.hidden = !this.stillUrl || state === 'error';
      if (this.stillUrl) this.still.src = this.stillUrl;
      this.label.textContent = text;
      this.cover.querySelector('svg').toggleAttribute('hidden', state !== 'still'); // the play mark only where a click starts it
      this.dataset.state = state;
    }
    fail(message) {
      this.release(false);
      this.showCover('Couldn\'t show the 3D view: ' + message, 'error');
    }
    // start the live 3D view
    start() {
      if (this.viewer || !this.getAttribute('src')) return;
      makeRoomFor(this);
      this.showCover('Loading 3D view…', 'loading');
      const v = this.viewer = embedViewer(this.slotEl, { src: this.frameUrl(), height: '100%', title: this.getAttribute('title') || '3D model', timeout: 60000 });
      v.iframe.style.visibility = 'hidden';
      liveEmbeds.add(this);
      v.on('error', (d) => { if (this.viewer === v) this.fail(d.message); });
      v.ready.then((info) => {
        if (this.viewer !== v) return;
        if (!info.model) { this.fail('the model could not be loaded.'); return; }
        v.iframe.style.visibility = '';
        this.cover.hidden = true;
        this.dataset.state = 'live';
        // take a still early, so a quick release still has a picture
        setTimeout(() => { if (this.viewer === v) v.snapshot().then((r) => { this.stillUrl = r.image; }, () => {}); }, 400);
      }, (e) => { if (this.viewer === v) this.fail(e.message); });
    }
    // swap the live view for its still (taken now, when keepStill) and free its 3D view
    release(keepStill = true) {
      const v = this.viewer;
      if (!v) return;
      this.viewer = null;
      liveEmbeds.delete(this);
      const done = () => { v.destroy(); if (!this.viewer && this.dataset.state !== 'error') this.showCover('Show 3D view', 'still'); };
      if (keepStill && v.info && v.info.model) {
        v.snapshot().then((r) => { this.stillUrl = r.image; }, () => {}).then(done);
        setTimeout(() => { if (v.iframe.isConnected) v.destroy(); }, 3000); // a busy frame doesn't hold on to its 3D view
      } else done();
    }
  }
  window.customElements.define('mockup-embed', MockupEmbed);
}
defineMockupEmbed();
