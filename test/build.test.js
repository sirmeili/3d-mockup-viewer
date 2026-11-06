import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { buildMockup, renderPage, renderPart, toBinaryStl, triangleCount, scadLiteral, readScadValue, parseScadValue, classicEmbed } from '../lib/index.js';

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
  assert.equal(scadLiteral(null), 'undef');
  assert.equal(scadLiteral([[1.3, 17, 'PWR'], [null, false]]), '[[1.3, 17, "PWR"], [undef, false]]');
  assert.equal(scadLiteral('a"b\\c\nd\te\u0001'), '"a\\"b\\\\c\\nd\\te\\x01"');
});

// the viewer's copy of the OpenSCAD value reader ("OpenSCAD values" in viewer.html), run the same cases as lib/scad.js
function viewerScadValues() {
  const src = fs.readFileSync(path.join(ROOT, 'src/viewer.html'), 'utf8');
  const block = /\/\/ ---------- OpenSCAD values[\s\S]*?(?=\n {2}\/\/ ----------)/.exec(src);
  assert.ok(block, 'viewer.html has an "OpenSCAD values" section');
  const ctx = {};
  vm.runInNewContext(block[0] + '\nthis.out = { readScadValue, parseScadValue, scadLiteral };', ctx);
  return ctx.out;
}
for (const [where, lib] of [['lib/scad.js', { readScadValue, parseScadValue, scadLiteral }], ['viewer.html', null]]) {
  test(`OpenSCAD values are read without evaluating (${where})`, () => {
    const { parseScadValue: parse, readScadValue: read, scadLiteral: write } = lib || viewerScadValues();
    const ok = (text, value) => assert.deepEqual(JSON.parse(JSON.stringify(parse(text))), { value }, text);
    const bad = (text, error) => { const r = parse(text); assert.ok(r.error, text + ' should not read'); if (error) assert.match(r.error, error, text); };
    ok('[[1.3, 17.0, "PWR"], [1.3, 23.0, "LNK"]]', [[1.3, 17, 'PWR'], [1.3, 23, 'LNK']]);
    ok(' [ .5 , -2 , 1e3, +4, 1. ] ', [0.5, -2, 1000, 4, 1]);
    ok('[true, false, undef, []]', [true, false, null, []]);
    ok('[\n  [1, 2],\n  [3, 4]\n]', [[1, 2], [3, 4]]);
    ok('"a;b // c"', 'a;b // c');
    ok('"q\\"\\\\\\n\\t\\x41\\u263A\\U01F600"', 'q"\\\n\tA☺\u{1F600}');
    ok('42', 42);
    ok('undef', null);
    bad('[1, 2', /Missing \]/);
    bad('[1, 2,]', /No comma/);
    bad('[1 2]', /Missing ,/);
    bad('[0:10]', /Ranges/);
    bad('[esp_y0 + 52, 10]', /Only numbers/);
    bad('[1 + 2]', /Only numbers/);
    bad('[for (i = [0:2]) i]', /Only numbers/);
    bad('[1, 2] x', /Only numbers/);
    bad('3mm', /Only numbers/);
    bad('"open', /Missing closing/);
    bad('"\\q"', /Unknown escape/);
    bad('"\\x80"', /Unknown escape/);
    bad('1e999', /too large/);
    bad('', /Enter a value/);
    assert.deepEqual(JSON.parse(JSON.stringify(read('wall = [1, 2], x = 3', 7))), { value: [1, 2], end: 13 });
    for (const v of [[[1.3, 17, 'PWR'], [null, true]], 'a"b\\c\nd\u0001', [], -0.25, 1e21]) {
      assert.deepEqual(JSON.parse(JSON.stringify(parse(write(v)).value)), JSON.parse(JSON.stringify(v)), 'round trip ' + JSON.stringify(v));
    }
  });
}

test('mockup render reads -D lists as OpenSCAD literals', () => {
  const dir = tmp();
  const f = path.join(dir, 'l.scad'), out = path.join(dir, 'l.stl');
  fs.writeFileSync(f, 'pts = [[0, 0]];\nfor (p = pts) translate([p[0], p[1], 0]) cube(1);\n');
  execFileSync(process.execPath, [path.join(ROOT, 'cli/mockup.js'), 'render', f, '-o', out, '-D', 'pts=[[0, 0], [5, .5]]'], { stdio: 'pipe' });
  const stl = fs.readFileSync(out);
  let maxX = -Infinity;
  for (let i = 0, n = stl.readUInt32LE(80); i < n; i++) for (let k = 0; k < 3; k++) maxX = Math.max(maxX, stl.readFloatLE(84 + i * 50 + 12 + k * 12));
  assert.equal(Math.round(maxX), 6, 'the second cube from the -D list was rendered');
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
