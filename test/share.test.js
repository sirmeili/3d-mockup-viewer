import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeShare, decodeShare, gatherShare, shareLink, SHARE_VERSION, SHARE_MAX_LENGTH, DEFAULT_SHARE_BASE } from '../lib/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'examples/sensor-box/manifest.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-share-'));
const pack = (obj) => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj))).toString('base64url');
const write = (dir, files) => Object.entries(files).forEach(([n, body]) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), body); });
const scadManifest = (file = 'box.scad') => JSON.stringify({ name: 'Box', parts: [{ id: 'box', scad: { file } }] });

test('gathers the sample and round-trips it through a link', () => {
  const { payload, files } = gatherShare({ manifest: SAMPLE, viewer: '9.9.9' });
  assert.deepEqual(files, ['sensor_box.scad']);
  assert.equal(payload.v, SHARE_VERSION);
  assert.equal(payload.main, 'sensor_box.scad');
  assert.equal(payload.manifest.parts.length, 9);
  assert.ok(payload.manifest.parts.every((p) => p.scad && p.file === undefined));
  const link = shareLink(DEFAULT_SHARE_BASE, payload);
  assert.ok(link.startsWith(DEFAULT_SHARE_BASE + '#m='));
  assert.ok(link.length < 4096, 'the sample stays a short link: ' + link.length);
  assert.deepEqual(decodeShare(link.split('#m=')[1]), payload);
});

test('follows include, use and text imports, and finds library files', () => {
  const dir = tmp(), lib = tmp();
  write(dir, {
    'm/manifest.json': scadManifest('src/box.scad'),
    'm/src/box.scad': 'include <parts/lid.scad>\nuse <../common/screws.scad>\ninclude <shapes.scad>\nimport("logo.svg");\n',
    'm/src/parts/lid.scad': 'module lid() cube(1);\n',
    'm/common/screws.scad': 'module screw() cylinder(1);\n',
    'm/src/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>'
  });
  write(lib, { 'shapes.scad': 'module shape() sphere(1);\n' });
  const { payload } = gatherShare({ manifest: path.join(dir, 'm/manifest.json'), libs: [lib] });
  assert.deepEqual(Object.keys(payload.sources).sort(), ['common/screws.scad', 'src/box.scad', 'src/logo.svg', 'src/parts/lid.scad', 'src/shapes.scad']);
  assert.match(payload.sources['src/shapes.scad'], /module shape/);
});

test('refuses what a link cannot carry', () => {
  const dir = tmp();
  write(dir, { 'png/manifest.json': scadManifest(), 'png/box.scad': 'surface("h.png");\nimport("h.png");\n', 'png/h.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]) });
  assert.throws(() => gatherShare({ manifest: path.join(dir, 'png/manifest.json') }), /h\.png is a binary file/);
  write(dir, { 'stl/manifest.json': scadManifest(), 'stl/box.scad': 'import("m.stl");\n', 'stl/m.stl': Buffer.alloc(84) });
  assert.throws(() => gatherShare({ manifest: path.join(dir, 'stl/manifest.json') }), /m\.stl is a binary file/);
  write(dir, { 'mesh/manifest.json': JSON.stringify({ parts: [{ id: 'board', file: 'board.stl' }] }) });
  assert.throws(() => gatherShare({ manifest: path.join(dir, 'mesh/manifest.json') }), /board has no scad source/);
  write(dir, { 'miss/manifest.json': scadManifest(), 'miss/box.scad': 'include <gone.scad>\n' });
  assert.throws(() => gatherShare({ manifest: path.join(dir, 'miss/manifest.json') }), /gone\.scad is missing/);
});

test('decoding rejects damaged, newer and oversized links', () => {
  const good = { v: 1, manifest: { parts: [] }, main: 'a.scad', sources: { 'a.scad': 'cube(1);' } };
  assert.deepEqual(decodeShare(encodeShare(good)), good);
  assert.throws(() => decodeShare('not a link!'), /damaged/);
  assert.throws(() => decodeShare(encodeShare(good).slice(0, 20)), /damaged|cut short/);
  assert.throws(() => decodeShare(pack({ ...good, v: 2, viewer: '3.0.0' })), /newer viewer \(3\.0\.0\)/);
  assert.throws(() => decodeShare(pack({ ...good, main: 'b.scad' })), /main OpenSCAD file/);
  assert.throws(() => decodeShare(pack({ ...good, sources: { 'a.scad': 1 } })), /not text/);
  assert.throws(() => decodeShare('A'.repeat(SHARE_MAX_LENGTH + 1)), /longer than/);
  const bomb = zlib.deflateRawSync(Buffer.alloc(6 * 1024 * 1024, 32)).toString('base64url');
  assert.throws(() => decodeShare(bomb), /could not be unpacked/);
});

test('mockup link prints a link that decodes', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'cli/mockup.js'), 'link', SAMPLE, '--base', 'http://localhost:8080/openscad/viewer.html'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.ok(out.startsWith('http://localhost:8080/openscad/viewer.html#m='));
  assert.equal(decodeShare(out.split('#m=')[1]).manifest.name, 'ESP32 Sensor Box');
});
