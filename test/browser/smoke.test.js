// Browser smoke tests: load every built page in headless Chromium at desktop and phone widths,
// in light and dark mode, and check that the model actually renders.
// Needs `npm run build` first and a Playwright Chromium (`npx playwright install chromium`).
// Screenshots go to test-results/ (uploaded by CI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'test-results');
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;

const VIEWPORTS = [
  { name: 'desktop', width: 1200, height: 1000 },
  { name: 'phone', width: 400, height: 860 }
];
const SCHEMES = ['light', 'dark'];
const PAGES = [
  { name: 'demo', url: 'demo.html', parts: 9, arrange: true },
  { name: 'openscad', url: 'openscad/index.html', parts: 9, arrange: true, scad: true },
  { name: 'url-mode', url: 'viewer.html?manifest=examples/sensor-box/manifest.json', parts: 9, arrange: true },
  { name: 'openscad-url-mode', url: 'openscad/viewer.html?manifest=../examples/sensor-box/manifest.json', parts: 9, scad: true }
];

let server, browser;

test.before(async () => {
  assert.ok(fs.existsSync(path.join(DIST, 'demo.html')), 'run `npm run build` first');
  fs.mkdirSync(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(ROOT, 'cli', 'mockup.js'), 'serve', DIST, '--port', String(PORT)], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(); });
    server.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 10000);
  });
  // SwiftShader gives headless Chromium a software WebGL implementation
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
});

// Offline runs (no CDN access) can point MOCKUP_TEST_CDN_DIR at an unpacked three@0.128.0 npm package
// with fflate's umd/index.js copied to <dir>/fflate.js. CI uses the real CDNs.
async function routeCdn(ctx) {
  const dir = process.env.MOCKUP_TEST_CDN_DIR;
  if (!dir) return;
  const map = [
    [/three\.js\/r128\/three\.min\.js$/, 'build/three.min.js'],
    [/OrbitControls\.js$/, 'examples/js/controls/OrbitControls.js'],
    [/STLLoader\.js$/, 'examples/js/loaders/STLLoader.js'],
    [/GLTFLoader\.js$/, 'examples/js/loaders/GLTFLoader.js'],
    [/fflate@0\.6\.9\/umd\/index\.js$/, 'fflate.js']
  ];
  await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => {
    const url = route.request().url();
    const hit = map.find(([re]) => re.test(url));
    if (hit) return route.fulfill({ path: path.join(dir, hit[1]), contentType: 'text/javascript' });
    return route.fulfill({ body: '', contentType: url.includes('fonts.googleapis') ? 'text/css' : 'application/octet-stream' });
  });
}

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

// Count distinct colours on the WebGL canvas. A blank canvas has one; a rendered model has hundreds.
async function canvasColours(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const src = document.getElementById('view');
      const c = document.createElement('canvas');
      c.width = 160; c.height = 100;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
      resolve(seen.size);
    }));
  }));
}

for (const pg of PAGES) {
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`${pg.name} renders (${vp.name}, ${scheme})`, async () => {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });
        await routeCdn(ctx);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        try {
          await page.goto(BASE + pg.url);
          await page.waitForFunction((n) => document.querySelectorAll('.pname, .pname-in').length >= n && document.getElementById('loading').hidden, pg.parts, { timeout: 60000 });
          await page.waitForTimeout(500);

          assert.equal(await page.locator('#title').textContent(), 'ESP32 Sensor Box');
          assert.equal(await page.locator('#status').textContent(), '', 'no load warnings');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
          const assembled = await canvasColours(page);
          assert.ok(assembled > 40, `model not drawn (${assembled} colours on the canvas)`);

          // exploded and see-inside views
          await page.click('#m-exploded');
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(SHOTS, `${pg.name}-${vp.name}-${scheme}-exploded.png`), fullPage: true });
          await page.click('#m-inside');
          await page.waitForTimeout(600);
          await page.click('#cut-x');
          await page.waitForTimeout(300);
          assert.ok(await canvasColours(page) > 40, 'model not drawn after section cut');
          await page.click('#cut-off');
          await page.click('#m-assembled');

          if (pg.arrange) {
            await page.click('#arrToggle');
            assert.equal(await page.locator('.pgroup.editing').count(), 3, 'Arrange shows one box per group');
            assert.ok(await page.locator('.ghead .fl').first().isVisible(), 'Arrange fields have visible labels');
            const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            assert.ok(over <= 1, `Arrange mode scrolls sideways by ${over}px`);
            await page.screenshot({ path: path.join(SHOTS, `${pg.name}-${vp.name}-${scheme}-arrange.png`), fullPage: true });
            await page.click('#arrToggle');
          }

          if (pg.scad && vp.name === 'desktop' && scheme === 'light') {
            // change a value and re-render all parts in the browser
            await page.fill('#sp-wall', '3');
            await page.click('#scadRender');
            await page.waitForFunction(() => /Rendered 9 of 9 parts/.test(document.getElementById('scadLog').textContent), null, { timeout: 180000 });
            assert.equal(await page.locator('#status').textContent(), '', 'no warnings after re-render');
            assert.ok(await canvasColours(page) > 40, 'model not drawn after re-render');
          }

          await page.screenshot({ path: path.join(SHOTS, `${pg.name}-${vp.name}-${scheme}.png`), fullPage: true });
          assert.deepEqual(errors, [], 'no page or console errors');
        } finally {
          await ctx.close();
        }
      });
    }
  }
}

// ---------- embedding API: a host page on another origin drives the viewer in an iframe ----------
// The host is a second real server on another port, so a different origin. (A Playwright-routed origin
// doesn't work: Chromium's local network access checks then refuse to frame localhost.)
const HOST_PORT = PORT + 1000;
const HOST = `http://localhost:${HOST_PORT}/`;
const MANIFEST_URL = BASE + 'examples/sensor-box/manifest.json';
let hostServer;

// Serves test/browser/embed-host.html and dist/embed.js, plus the sample files under /files/.
test.before(async () => {
  const send = (res, file, type) => fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': type }); res.end(body);
  });
  hostServer = http.createServer((req, res) => {
    const p = new URL(req.url, HOST).pathname;
    if (p === '/') send(res, path.join(ROOT, 'test', 'browser', 'embed-host.html'), 'text/html; charset=utf-8');
    else if (p === '/embed.js') send(res, path.join(DIST, 'embed.js'), 'text/javascript');
    else if (p.startsWith('/files/')) send(res, path.join(DIST, 'examples', 'sensor-box', path.basename(p)), 'application/octet-stream');
    else { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((resolve) => hostServer.listen(HOST_PORT, resolve));
});
test.after(() => { if (hostServer) hostServer.close(); });

async function openHost(viewerPath, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await routeCdn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(HOST + '?viewer=' + encodeURIComponent(BASE + viewerPath) + query);
  const frame = () => page.frames().find((f) => f.url().startsWith(BASE));
  return { ctx, page, errors, frame };
}

test('embed: host loads by URL, sets controls, and gets change events from Arrange', async () => {
  const { ctx, page, errors, frame } = await openHost('viewer.html');
  try {
    const ready = await page.evaluate(() => viewer.ready);
    assert.equal(ready.edition, 'standard');
    assert.equal(ready.model, null, 'empty viewer has no model yet');

    const res = await page.evaluate((u) => viewer.load(u), MANIFEST_URL);
    assert.equal(res.parts, 9);
    assert.deepEqual(res.groups.map((g) => g.id), ['base', 'lid', 'board']);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.units, 'mm');
    await page.waitForFunction(() => events.some((e) => e.type === 'loaded' && e.data.parts === 9));
    const f = frame();
    assert.ok(await canvasColours(f) > 40, 'model drawn inside the iframe');

    await page.evaluate(() => viewer.setMode('exploded'));
    assert.equal(await f.getAttribute('#m-exploded', 'aria-pressed'), 'true');
    await page.evaluate(() => viewer.setView('top'));
    assert.equal(await f.getAttribute('#v-top', 'aria-pressed'), 'true');
    await page.evaluate(() => viewer.setFinish('Slate blue'));
    assert.equal(await f.getAttribute('#f-slate-blue', 'aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => viewer.setCut('x', 0.25)), { axis: 'x', position: 0.25 });
    assert.equal(await f.getAttribute('#cut-x', 'aria-pressed'), 'true');
    await page.evaluate(() => viewer.setCut('off'));

    // bad input comes back as a coded error, not silence
    const code = (fn) => page.evaluate(fn);
    assert.equal(await code(() => viewer.setMode('sideways').then(() => null, (e) => e.code)), 'bad-value');
    assert.equal(await code(() => viewer.scad.setValues({ wall: 3 }).then(() => null, (e) => e.code)), 'unsupported');
    assert.equal(await code(() => viewer.send('explode').then(() => null, (e) => e.code)), 'unknown-type');

    await page.evaluate(() => viewer.setArrange(true));
    assert.equal(await f.locator('.pgroup.editing').count(), 3, 'Arrange opened by the host');
    await f.fill('#p-name-lid', 'Top cover');
    await f.dispatchEvent('#p-name-lid', 'change');
    await page.waitForFunction(() => events.some((e) => e.type === 'change'), null, { timeout: 5000 });
    const changed = await page.evaluate(() => events.find((e) => e.type === 'change').data.manifest);
    assert.equal(changed.parts.find((p) => p.id === 'lid').name, 'Top cover');
    const mf = await page.evaluate(() => viewer.getManifest());
    assert.equal(mf.parts.find((p) => p.id === 'lid').name, 'Top cover');

    await page.screenshot({ path: path.join(SHOTS, 'embed-host-arrange.png'), fullPage: true });
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

test('embed: host sends file bytes (transferred) with a manifest object', async () => {
  const { ctx, page, errors, frame } = await openHost('viewer.html');
  try {
    const res = await page.evaluate(async () => {
      await viewer.ready;
      const manifest = await (await fetch('files/manifest.json')).json();
      const files = {};
      for (const p of manifest.parts) files[p.file] = await (await fetch('files/' + p.file)).arrayBuffer();
      const first = files[manifest.parts[0].file];
      const r = await viewer.load({ manifest, files });
      return { parts: r.parts, warnings: r.warnings, detached: first.byteLength === 0 };
    });
    assert.deepEqual(res, { parts: 9, warnings: [], detached: true });
    assert.equal(await frame().locator('#title').textContent(), 'ESP32 Sensor Box');
    assert.ok(await canvasColours(frame()) > 40, 'model drawn inside the iframe');
    const bad = await page.evaluate(() => viewer.load({ manifest: { parts: [] }, files: { 'notes.txt': new ArrayBuffer(4) } }).then(() => null, (e) => e.code));
    assert.equal(bad, 'no-parts');
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

test('embed: viewer ignores hosts that are not allowed', async () => {
  const cases = [['no ?parent=', 'viewer.html'], ['another origin', 'viewer.html?parent=' + encodeURIComponent('http://other.test')]];
  for (const [label, viewerPath] of cases) {
    const { ctx, page, frame } = await openHost(viewerPath, '&addParent=0&timeout=4000');
    try {
      assert.equal(await page.evaluate(() => viewer.ready.then(() => 'ready', (e) => e.code)), 'timeout', label);
      // a raw message straight to the frame is ignored too
      await page.evaluate((u) => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'mockup-viewer', version: 1, id: 1, type: 'load', manifest: u }, '*'), MANIFEST_URL);
      await page.waitForTimeout(1500);
      assert.equal(await frame().locator('.pname').count(), 0, label + ': nothing loaded');
      assert.deepEqual(await page.evaluate(() => events.map((e) => e.type)), [], label + ': no messages from the viewer');
    } finally {
      await ctx.close();
    }
  }
});

test('embed: OpenSCAD edition takes values from the host and re-renders', async () => {
  const { ctx, page, errors, frame } = await openHost('openscad/viewer.html');
  try {
    assert.equal((await page.evaluate(() => viewer.ready)).edition, 'openscad');
    assert.equal((await page.evaluate((u) => viewer.load(u), MANIFEST_URL)).parts, 9);
    const set = await page.evaluate(() => viewer.scad.setValues({ wall: 3 }));
    assert.equal(set.values.wall, 3);
    assert.equal(await frame().inputValue('#sp-wall'), '3');
    const bad = await page.evaluate(() => viewer.scad.setValues({ wall: 'thick', nope: 1 }).then(() => null, (e) => e.code + ': ' + e.message));
    assert.match(bad, /^bad-values: .*wall \(expects a number\).*nope \(no such value\)/);
    assert.equal(await frame().inputValue('#sp-wall'), '3', 'a rejected update changes nothing');
    const res = await page.evaluate(() => viewer.scad.render());
    assert.equal(res.parts, 9);
    assert.deepEqual(res.warnings, []);
    assert.match(await frame().locator('#scadLog').textContent(), /Rendered 9 of 9 parts/);
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});
