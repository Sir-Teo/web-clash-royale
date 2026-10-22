// Bounded reader for the archived SC1 export, shape and display-list tables.
// Coordinates are twips; matrix scale terms use 1/1024.
export function parseSC(b) {
  let p = 17,
    n = b.readUInt16LE(p);
  p += 2;
  const ids = Array.from({ length: n }, () => {
    const v = b.readUInt16LE(p);
    p += 2;
    return v;
  });
  const names = {};
  for (let i = 0; i < n; i++) {
    const len = b[p++];
    names[b.toString("utf8", p, p + len)] = ids[i];
    p += len;
  }
  const shapes = {},
    clips = {},
    matrices = [],
    textures = [],
    colors = [];
  while (p + 5 <= b.length) {
    const tag = b[p],
      len = b.readUInt32LE(p + 1),
      end = p + 5 + len;
    let q = p + 5;
    if (end > b.length) throw new Error("SC range error");
    if (tag === 1 || tag === 24)
      textures.push([b.readUInt16LE(q + 1), b.readUInt16LE(q + 3)]);
    if (tag === 9) {
      if (len !== 7) throw new Error("Unsupported SC color transform");
      colors.push([...b.subarray(q, q + 7)]);
    }
    if (tag === 8)
      matrices.push([
        b.readInt32LE(q) / 1024,
        b.readInt32LE(q + 4) / 1024,
        b.readInt32LE(q + 8) / 1024,
        b.readInt32LE(q + 12) / 1024,
        b.readInt32LE(q + 16) / 20,
        b.readInt32LE(q + 20) / 20,
      ]);
    if (tag === 18) {
      const id = b.readUInt16LE(q),
        count = b.readUInt16LE(q + 2);
      q += 6;
      const polygons = [];
      for (let i = 0; i < count; i++) {
        const st = q + 5,
          sz = b.readUInt32LE(q + 1);
        q = st;
        const sheet = b[q++],
          points = b[q++],
          xy = [],
          uv = [];
        for (let j = 0; j < points; j++) {
          xy.push([b.readInt32LE(q) / 20, b.readInt32LE(q + 4) / 20]);
          q += 8;
        }
        for (let j = 0; j < points; j++) {
          uv.push([b.readUInt16LE(q) / 65535, b.readUInt16LE(q + 2) / 65535]);
          q += 4;
        }
        polygons.push({ sheet, xy, uv });
        q = st + sz;
      }
      shapes[id] = polygons;
    }
    if (tag === 12) {
      const id = b.readUInt16LE(q),
        fps = b[q + 2],
        nf = b.readUInt16LE(q + 3),
        count = b.readInt32LE(q + 5);
      q += 9;
      const refs = [];
      for (let i = 0; i < count; i++) {
        refs.push([
          b.readUInt16LE(q),
          b.readUInt16LE(q + 2),
          b.readUInt16LE(q + 4),
        ]);
        q += 6;
      }
      const nc = b.readUInt16LE(q);
      q += 2;
      const children = [];
      for (let i = 0; i < nc; i++) {
        children.push(b.readUInt16LE(q));
        q += 2;
      }
      q += nc;
      for (let i = 0; i < nc; i++) {
        const l = b[q++];
        if (l < 255) q += l;
      }
      const frames = [];
      let offset = 0;
      while (q + 5 <= end) {
        const t = b[q],
          l = b.readUInt32LE(q + 1);
        if (t === 11) {
          const count = b.readUInt16LE(q + 5);
          frames.push(
            refs.slice(offset, offset + count).map(([child, mat, color]) => ({
              id: children[child],
              matrix: mat,
              color,
            })),
          );
          offset += count;
        }
        q += 5 + l;
      }
      clips[id] = { fps, nf, frames };
    }
    p = end;
    if (tag === 0) break;
  }
  return { names, shapes, clips, matrices, textures, colors };
}
