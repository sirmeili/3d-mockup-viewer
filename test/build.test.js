import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockup, renderPage, renderPart, toBinaryStl, triangleCount, scadLiteral } from '../lib/index.js';

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
