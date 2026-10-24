// STL helpers.

/** True when the buffer looks like an ASCII STL. */
export function isAsciiStl(buf) {
  const head = buf.subarray(0, 512).toString('latin1').trimStart().toLowerCase();
  return head.startsWith('solid') && buf.subarray(0, 4096).toString('latin1').toLowerCase().includes('facet');
}

/** Convert ASCII STL to binary (about 4x smaller). Binary input is returned unchanged. */
export function toBinaryStl(buf) {
  if (!isAsciiStl(buf)) return buf;
  const text = buf.toString('latin1');
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  const v = [];
  let m;
  while ((m = re.exec(text))) v.push(+m[1], +m[2], +m[3]);
  const n = Math.floor(v.length / 9);
  const out = Buffer.alloc(84 + n * 50);
  out.write('binary STL from 3d-mockup-viewer', 0, 'latin1');
  out.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50, k = i * 9;
    const ux = v[k + 3] - v[k], uy = v[k + 4] - v[k + 1], uz = v[k + 5] - v[k + 2];
    const wx = v[k + 6] - v[k], wy = v[k + 7] - v[k + 1], wz = v[k + 8] - v[k + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.writeFloatLE(nx / l, o); out.writeFloatLE(ny / l, o + 4); out.writeFloatLE(nz / l, o + 8);
    for (let j = 0; j < 9; j++) out.writeFloatLE(v[k + j], o + 12 + j * 4);
  }
  return out;
}

/** Triangle count of a binary STL. */
export function triangleCount(buf) {
  return buf.length >= 84 ? buf.readUInt32LE(80) : 0;
}
