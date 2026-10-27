import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildMockup, renderPage, renderPart, toBinaryStl, triangleCount, scadLiteral, classicEmbed } from '../lib/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-test-'));
const dataOf = (html) => JSON.parse(/<script id="mockup-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/<\\\//g, '</'));

test('builds the sample enclosure from OpenSCAD', async () => {
  const dir = tmp();
  const out = path.join(dir, 'page.html');
  const res = await buildMockup({ manifest: path.join(ROOT, 'examples/sensor-box/manifest.json'), out, stlDir: dir });
  assert.equal(res.parts, 9);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<title>ESP32 Sensor Box<\/title>/);
  const data = dataOf(html);
  assert.equal(data.dropIn, false);
  assert.equal(Object.keys(data.files).length, 9);
  assert.equal(data.manifest.parts[0].scad, undefined, 'scad sources are not embedded by default');
  assert.ok(triangleCount(fs.readFileSync(path.join(dir, 'base.stl'))) > 100);
});

test('OpenSCAD edition embeds sources and the add-on', async () => {
  const dir = tmp();
  const out = path.join(dir, 'page.html');
  await buildMockup({ manifest: path.join(ROOT, 'examples/sensor-box/manifest.json'), out, stlDir: dir, embedScad: true, addon: 'openscad', dropIn: true });
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('window.mockupScad'));
  const data = dataOf(html);
  assert.ok(data.scad.sources['sensor_box.scad'].includes('module base()'));
  assert.deepEqual(data.manifest.parts[0].scad, { file: 'sensor_box.scad', defines: { part: 'base' } });
});

test('omitted parts are not rendered or embedded, but stay in the manifest', async () => {
  const dir = tmp();
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/sensor-box/manifest.json'), 'utf8'));
  mf.parts.forEach((p) => { p.scad.file = path.relative(dir, path.join(ROOT, 'examples/sensor-box', p.scad.file)).split(path.sep).join('/'); });
  mf.parts.find((p) => p.id === 'pipes').omit = true;
  mf.parts.find((p) => p.id === 'lid').hidden = true;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf));
  const out = path.join(dir, 'page.html');
  const res = await buildMockup({ manifest: path.join(dir, 'manifest.json'), out, stlDir: dir });
  assert.equal(res.parts, 8);
  assert.ok(!fs.existsSync(path.join(dir, 'pipes.stl')), 'the omitted part is not rendered');
  const data = dataOf(fs.readFileSync(out, 'utf8'));
  assert.equal(Object.keys(data.files).length, 8);
  const pipes = data.manifest.parts.find((p) => p.id === 'pipes');
  assert.equal(pipes.omit, true);
  assert.equal(data.manifest.parts.find((p) => p.id === 'lid').hidden, true);
});

test('text() renders with the bundled fonts', async () => {
  const dir = tmp();
  const f = path.join(dir, 't.scad');
  fs.writeFileSync(f, 'linear_extrude(1) text("RNET", font = "Liberation Sans:style=Bold");');
  const res = await renderPart({ scadFile: f });
  assert.ok(res.stl, res.log.join('\n'));
  assert.ok(triangleCount(res.stl) > 50);
});

test('defines become OpenSCAD literals', () => {
  assert.equal(scadLiteral('lid'), '"lid"');
  assert.equal(scadLiteral(true), 'true');
  assert.equal(scadLiteral([1, 2.5, 'a']), '[1, 2.5, "a"]');
});

test('ASCII STL converts to binary', () => {
  const ascii = Buffer.from('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n');
  const bin = toBinaryStl(ascii);
  assert.equal(triangleCount(bin), 1);
  assert.equal(bin.length, 134);
});

test('empty viewer keeps a null data tag for URL loading', () => {
  const html = renderPage({ data: null });
  assert.match(html, /<script id="mockup-data" type="application\/json">null<\/script>/);
  assert.ok(html.includes("get('manifest')"));
});

test('embed origins are written into the page; embedding is off by default', () => {
  assert.match(renderPage({ data: null }), /<meta name="mockup-embed-origins" content="">/);
  const html = renderPage({ data: null, embedOrigins: ['https://tracker.lan/some/path', 'http://localhost:5173'] });
  assert.match(html, /<meta name="mockup-embed-origins" content="https:\/\/tracker\.lan http:\/\/localhost:5173">/);
  assert.throws(() => renderPage({ data: null, embedOrigins: ['javascript:alert(1)'] }), /http or https/);
});

test('the embed helper converts to a classic script', () => {
  const js = classicEmbed();
  assert.doesNotThrow(() => new vm.Script(js), 'parses as a classic script');
  assert.doesNotMatch(js, /^\s*(export|import)\b|import\.meta/m);
  const win = { customElements: undefined };
  vm.runInNewContext(js, { window: win, document: { currentScript: { src: 'https://example.test/embed.js' } }, location: { href: 'https://example.test/' } });
  assert.equal(typeof win.mockupViewer.embedViewer, 'function', 'exports land on window.mockupViewer');
  assert.equal(win.mockupViewer.PROTOCOL, 'mockup-viewer');
  assert.throws(() => classicEmbed('export default 1;'), /module syntax/);
});
