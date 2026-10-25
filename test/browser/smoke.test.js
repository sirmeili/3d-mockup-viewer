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

// ---------- manifest editor ----------
async function openDemo(vp, scheme, extra = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme }, extra));
  await routeCdn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'demo.html');
  await page.waitForFunction(() => document.querySelectorAll('.pname').length >= 9 && document.getElementById('loading').hidden, null, { timeout: 60000 });
  return { ctx, page, errors };
}
const stageInDialog = (page) => page.evaluate(() => !!document.querySelector('#edPreview #stage'));

for (const [vp, scheme] of [[VIEWPORTS[0], 'light'], [VIEWPORTS[1], 'dark']]) {
  test(`manifest editor: page section, undo/redo, change list (${vp.name}, ${scheme})`, async () => {
    const { ctx, page, errors } = await openDemo(vp, scheme);
    try {
      await page.click('#edOpen');
      assert.ok(await page.evaluate(() => document.getElementById('editor').open), 'dialog opens');
      // the live preview is the viewer's own stage on wide screens; phones leave it in place
      assert.equal(await stageInDialog(page), vp.name === 'desktop');
      if (vp.name === 'desktop') assert.ok(await canvasColours(page) > 40, 'model drawn in the preview');
      assert.match(await page.textContent('#edMain .ed-help'), /How to use:/);

      await page.fill('#ed-page-name', 'Renamed box');
      assert.equal(await page.textContent('#title'), 'Renamed box', 'title changes as you type');
      await page.fill('#ed-page-units', 'in');
      assert.match(await page.textContent('#dims'), / in$/);
      assert.deepEqual(await page.$$eval('#edChanges li', (l) => l.map((x) => x.textContent)),
        ['Title: "ESP32 Sensor Box" → "Renamed box"', 'Units: "mm" → "in"']);
      assert.equal(await page.textContent('#edCount'), '2 changes from the loaded manifest');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `editor scrolls sideways by ${over}px`);
      await page.screenshot({ path: path.join(SHOTS, `editor-page-${vp.name}-${scheme}.png`) });

      await page.click('#edUndo');
      assert.match(await page.textContent('#dims'), / mm$/, 'undo restores units');
      assert.equal(await page.inputValue('#ed-page-units'), '');
      await page.click('#edRedo');
      assert.match(await page.textContent('#dims'), / in$/, 'redo applies it again');
      await page.click('#edResetSection');
      assert.equal(await page.textContent('#title'), 'ESP32 Sensor Box', 'Reset section clears page edits');
      assert.equal(await page.textContent('#edCount'), 'No changes');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('editor').open && !!document.querySelector('.wrap > #stage'));
      assert.ok(await canvasColours(page) > 40, 'model drawn after closing');
      assert.deepEqual(errors, [], 'no page or console errors');
    } finally {
      await ctx.close();
    }
  });
}

test('manifest editor: shares edits and undo with Arrange, copies the manifest', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[0], 'light', { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await page.click('#arrToggle');
    await page.fill('#p-name-lid', 'Top cover');
    await page.dispatchEvent('#p-name-lid', 'change');
    await page.click('#edOpen');
    assert.deepEqual(await page.$$eval('#edChanges li', (l) => l.map((x) => x.textContent)), ['Lid renamed to Top cover'], 'Arrange edits show in the editor');
    await page.fill('#ed-page-name', 'Renamed box');
    await page.click('#edCopy');
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(copied.name, 'Renamed box');
    assert.equal(copied.parts.find((p) => p.id === 'lid').name, 'Top cover');
    await page.click('#edUndo');
    await page.click('#edUndo');
    assert.equal(await page.textContent('#edCount'), 'No changes', 'undo steps back through Arrange edits too');
    await page.click('#edDone');
    assert.equal(await page.inputValue('#p-name-lid'), 'Lid');
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

const changeList = (page) => page.$$eval('#edChanges li', (l) => l.map((x) => x.textContent));
const copiedManifest = async (page) => { await page.click('#edCopy'); return JSON.parse(await page.evaluate(() => navigator.clipboard.readText())); };

test('manifest editor: parts, groups and the up axis', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[0], 'light', { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await page.click('#edOpen');
    await page.click('#ed-nav-parts');
    assert.equal(await page.textContent('#ed-count-parts'), '9');
    await page.click('#ed-part-edit-rj45');
    assert.ok(await page.locator('#ed-part-id-rj45').evaluate((e) => e.readOnly), 'part ids are read-only');
    await page.selectOption('#ed-part-mat-rj45', 'brass');
    await page.click('#ed-part-edit-pipes');
    await page.selectOption('#ed-part-group-pipes', 'board');
    await page.fill('#ed-part-file-pipes', 'stl/pipes.stl');
    await page.selectOption('#ed-part-src-pipes', 'scad');
    assert.equal(await page.textContent('#ed-part-err-pipes'), 'Name the .scad file.');
    await page.fill('#ed-part-file-pipes', 'case.scad');
    await page.fill('#ed-part-defs-pipes', 'part pipes');
    assert.match(await page.textContent('#ed-part-err-pipes'), /name = value/);
    await page.fill('#ed-part-defs-pipes', 'part = "pipes", wall = 3');
    assert.equal(await page.textContent('#ed-part-err-pipes'), '');
    assert.deepEqual(await changeList(page), ['Light pipes: Lid → Board', 'RJ45 jack: Metal → Brass', 'Light pipes: source → case.scad (part = "pipes", wall = 3)']);

    await page.click('#ed-nav-groups');
    await page.fill('#ed-group-ex-z-lid', '50');
    assert.equal(await page.getAttribute('#m-exploded', 'aria-pressed'), 'true', 'editing an offset shows the Exploded view');
    assert.ok((await changeList(page)).includes('Lid: explode Z 44 → 50'));
    await page.click('#ed-group-del-board');
    assert.equal(await page.textContent('#ed-count-groups'), '9 · 1 changed', 'board parts (light pipes included) get groups of their own');
    await page.click('#edUndo');
    assert.equal(await page.textContent('#ed-count-groups'), '3 · 1 changed', 'undo brings the group back');

    await page.click('#ed-nav-page');
    await page.selectOption('#ed-page-up', 'y');
    assert.equal(await page.textContent('#dims'), '70 × 22 × 50 mm', 'Y up turns the model');
    assert.ok(await canvasColours(page) > 40, 'model still drawn after turning it');
    const mf = await copiedManifest(page);
    assert.equal(mf.up, 'y');
    const pipes = mf.parts.find((p) => p.id === 'pipes');
    assert.deepEqual([pipes.group, pipes.scad], ['board', { file: 'case.scad', defines: { part: 'pipes', wall: 3 } }]);
    assert.equal(mf.parts.find((p) => p.id === 'rj45').material, 'brass');
    assert.deepEqual(mf.groups.lid.explode, [0, 0, 50]);
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

test('manifest editor: views, finishes and the spec sheet', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[0], 'light', { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await page.click('#edOpen');
    await page.click('#ed-nav-views');
    await page.uncheck('#ed-view-show-rear');
    assert.equal(await page.locator('#v-rear').count(), 0, 'hidden view loses its button');
    await page.click('#ed-view-add');
    assert.equal(await page.locator('#v-view-1').count(), 1, 'new view gets a button');
    await page.check('#ed-view-default-top');
    assert.equal(await page.getAttribute('#v-top', 'aria-pressed'), 'true');
    assert.deepEqual(await changeList(page), ['View added: View 1', 'View hidden: Rear', 'Opens on: 3/4 → Top']);

    await page.click('#ed-nav-finishes');
    await page.fill('#ed-finish-color-2', '#112233');
    assert.equal(await page.locator('#f-slate-blue').evaluate((e) => e.style.background), 'rgb(17, 34, 51)');
    await page.click('#ed-finish-add');
    assert.equal(await page.locator('#f-new-finish').count(), 1);
    await page.click('#ed-finish-default-1');
    assert.equal(await page.locator('#finishes .swatch').first().getAttribute('id'), 'f-bone-white', 'Make default moves the swatch to the front');

    await page.click('#ed-nav-spec');
    await page.fill('#ed-spec-title-0', 'Dimensions');
    assert.equal(await page.locator('#sheet h2').first().textContent(), 'Dimensions');
    await page.selectOption('#ed-spec-type-1', 'rows');
    assert.equal(await page.inputValue('#ed-spec-1-label-0'), 'RJ45, front (17 × 14.5 mm)', 'bullets carry over as rows');
    assert.equal(await page.locator('#sheet section').nth(1).locator('dl').count(), 1);
    await page.click('#ed-spec-add');
    assert.equal(await page.locator('#sheet section').count(), 5, 'three sections, a new one, and Model data');
    const specChanges = (await changeList(page)).filter((c) => /^Section/.test(c));
    assert.deepEqual(specChanges, ['Section renamed: Size and fit → Dimensions', 'Section edited: Openings', 'Section added: New section']);
    await page.screenshot({ path: path.join(SHOTS, 'editor-spec-desktop-light.png') });

    const mf = await copiedManifest(page);
    assert.equal(mf.defaultView, 'top');
    assert.deepEqual(mf.views.map((v) => (typeof v === 'string' ? v : v.name)), ['front', 'left', 'top', 'iso', 'View 1']);
    assert.deepEqual(mf.finishes.map((f) => f.name), ['Bone white', 'Graphite', 'Slate blue', 'New finish']);
    assert.equal(mf.spec[0].title, 'Dimensions');
    assert.ok(Array.isArray(mf.spec[1].rows));
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

// drag a grip onto a point (fraction of the target's height) with the mouse
async function mouseDrag(page, grip, target, frac) {
  const a = await page.locator(grip).boundingBox(), b = await page.locator(target).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * frac, { steps: 8 });
  await page.mouse.up();
}
const panelParts = (page) => page.$$eval('#parts .pname', (l) => l.map((x) => x.textContent));

test('manifest editor: reorder by keyboard, buttons and drag', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[0], 'light', { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await page.click('#edOpen');
    await page.click('#ed-nav-parts');
    // arrow keys on a grip; focus stays with the moved part
    await page.focus('#ed-part-module-grip');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'ed-part-module-grip');
    assert.deepEqual((await panelParts(page)).slice(3, 5), ['ESP32 module', 'ESP32 board'], 'the parts panel follows the new order');
    // mouse drag into another group: light pipes onto the top half of the RJ45 card
    await mouseDrag(page, '#ed-part-pipes-grip', '#ed-part-edit-rj45 >> xpath=../..', 0.25);
    assert.ok((await changeList(page)).includes('Light pipes: Lid → Board'), 'dropping in another group moves the part there');

    await page.click('#ed-nav-groups');
    await page.click('#ed-group-lid-down');
    assert.ok((await changeList(page)).includes('Groups reordered'));

    await page.click('#ed-nav-finishes');
    await page.focus('#ed-finish-2-grip');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'ed-finish-1-grip', 'focus follows the moved swatch');

    await page.click('#ed-nav-views');
    await mouseDrag(page, '#ed-view-iso-grip', '#ed-view-front-grip >> xpath=../..', 0.2);
    assert.equal(await page.locator('#viewSeg button').first().getAttribute('id'), 'v-iso', '3/4 dragged to the front');

    await page.click('#ed-nav-spec');
    await page.focus('#ed-spec-0-row-0-grip');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(await page.$$eval('#sheet section:first-child dt', (l) => l.slice(0, 2).map((x) => x.textContent)), ['Board', 'Outside']);
    // a touch drag: pointer events with pointerType touch, moving the Printing section to the top
    const grip = page.locator('#ed-spec-sec-2-grip');
    const a = await grip.boundingBox(), b = await page.locator('#ed-spec-title-0').boundingBox();
    await grip.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, button: 0, clientX: a.x + 5, clientY: a.y + 5, bubbles: true });
    await grip.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, clientX: a.x + 5, clientY: b.y - 30, bubbles: true });
    await grip.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, clientX: a.x + 5, clientY: b.y - 30, bubbles: true });
    assert.equal(await page.locator('#sheet h2').first().textContent(), 'Printing');

    const mf = await copiedManifest(page);
    assert.deepEqual(Object.keys(mf.groups), ['base', 'board', 'lid'], 'group order kept in the manifest');
    assert.deepEqual(mf.parts.map((p) => p.id), ['base', 'module', 'pcb', 'pipes', 'rj45', 'usbc', 'header', 'leds', 'lid'], 'parts listed group by group, in the shown order');
    assert.deepEqual(mf.finishes.map((f) => f.name), ['Graphite', 'Slate blue', 'Bone white']);
    assert.equal(mf.views[0], 'iso');
    assert.equal(mf.spec[0].title, 'Printing');
    await page.click('#edResetAll');
    assert.deepEqual(await panelParts(page), ['Case base', 'Lid', 'Light pipes', 'ESP32 board', 'ESP32 module', 'RJ45 jack', 'USB-C port', 'UEXT header', 'Status LEDs'], 'Reset all restores the loaded order');
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

test('manifest editor: Raw JSON checks, applies and undoes', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[0], 'light', { permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    assert.equal(await page.locator('header #edOpen').count(), 1, 'Edit manifest sits in the header, beside Load files');
    await page.click('#edOpen');
    await page.click('#ed-nav-json');
    const text = await page.inputValue('#ed-json');
    const mf = JSON.parse(text);
    assert.equal(mf.name, 'ESP32 Sensor Box', 'the box starts with the current manifest');
    assert.ok(await page.locator('#ed-json-apply').isDisabled(), 'nothing to apply yet');

    // not JSON: one problem with a line, Go to line selects it
    await page.fill('#ed-json', text.replace('"up": "z",', '"up": "z"'));
    const problem = await page.locator('.ed-problem').first().textContent();
    assert.match(problem, /^Line \d+: This isn't valid JSON/);
    assert.ok(await page.locator('#ed-json-apply').isDisabled());
    assert.match(await page.textContent('#ed-count-json'), /^1 error/);
    await page.locator('.ed-problem button').first().click();
    assert.ok(await page.evaluate(() => { const t = document.getElementById('ed-json'); return document.activeElement === t && t.selectionEnd > t.selectionStart; }), 'Go to line selects the line');

    // valid JSON with mistakes the checks explain
    const bad = JSON.parse(text);
    bad.groups.lid.explode = [0, 48];
    bad.parts.push({ id: 'antenna' });
    bad.parts = bad.parts.filter((p) => p.id !== 'leds');
    bad.parts.find((p) => p.id === 'rj45').material = 'chrome';
    await page.fill('#ed-json', JSON.stringify(bad, null, 2));
    const problems = await page.$$eval('.ed-problem span', (l) => l.map((x) => x.textContent));
    assert.ok(problems.some((t) => /no loaded part "antenna"/.test(t)), 'unknown part explained');
    assert.ok(problems.some((t) => /Loaded part "leds" is missing/.test(t)), 'missing part explained');
    assert.ok(problems.some((t) => /material "chrome" isn't known/.test(t)), 'bad material explained');
    assert.ok(problems.some((t) => /^Line \d+: Group "lid": "explode" needs 3 numbers/.test(t)), 'bad offset explained with its line');
    await page.screenshot({ path: path.join(SHOTS, 'editor-json-desktop-light.png') });
    assert.ok(await page.locator('#ed-json-apply').isDisabled());

    // a good edit applies in one step
    const good = JSON.parse(text);
    good.name = 'From JSON';
    good.groups.lid.explode = [0, 0, 60];
    good.finishes.reverse();
    good.parts.find((p) => p.id === 'rj45').material = 'brass';
    await page.fill('#ed-json', JSON.stringify(good, null, 2));
    assert.equal(await page.locator('.ed-problem').count(), 0);
    assert.equal(await page.textContent('#ed-count-json'), 'not applied');
    await page.click('#ed-json-apply');
    assert.equal(await page.textContent('#title'), 'From JSON');
    assert.equal(await page.textContent('#ed-json-note'), 'Applied. The model and every section now match the JSON.');
    assert.deepEqual(await changeList(page), ['Title: "ESP32 Sensor Box" → "From JSON"', 'RJ45 jack: Metal → Brass', 'Lid: explode Z 44 → 60', 'Opens with Slate blue']);
    assert.deepEqual(JSON.parse(await page.inputValue('#ed-json')).groups.lid.explode, [0, 0, 60], 'the box shows the result');
    await page.click('#edUndo');
    assert.equal(await page.textContent('#title'), 'ESP32 Sensor Box', 'one Undo reverts the whole Apply');

    // the current manifest applied unchanged is not a change; paste and revert
    await page.click('#ed-json-revert');
    assert.ok(await page.locator('#ed-json-apply').isDisabled());
    await page.evaluate((t) => navigator.clipboard.writeText(t), JSON.stringify(good));
    await page.click('#ed-json-paste');
    await page.waitForFunction(() => /^Pasted/.test(document.getElementById('ed-json-note').textContent));
    assert.equal(await page.inputValue('#ed-json'), JSON.stringify(good));
    await page.click('#ed-json-format');
    assert.equal(await page.inputValue('#ed-json'), JSON.stringify(good, null, 2));
    await page.click('#ed-json-revert');
    assert.deepEqual(JSON.parse(await page.inputValue('#ed-json')).name, 'ESP32 Sensor Box');
    assert.equal(await page.textContent('#ed-count-json'), '');
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

test('manifest editor: sections fit a phone (dark)', async () => {
  const { ctx, page, errors } = await openDemo(VIEWPORTS[1], 'dark');
  try {
    await page.click('#edOpen');
    for (const id of ['parts', 'groups', 'views', 'finishes', 'spec', 'json']) {
      await page.click('#ed-nav-' + id);
      if (id === 'parts') await page.click('#ed-part-edit-lid');
      const over = await page.evaluate(() => {
        const main = document.getElementById('edMain');
        return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
      });
      assert.ok(over <= 1, `${id} section scrolls sideways by ${over}px`);
      await page.screenshot({ path: path.join(SHOTS, `editor-${id}-phone-dark.png`) });
    }
    assert.deepEqual(errors, [], 'no page or console errors');
  } finally {
    await ctx.close();
  }
});

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
