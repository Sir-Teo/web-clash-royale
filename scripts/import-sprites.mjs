// Decode the bounded SC export/clip tables, then import already-decoded PNG shapes.
// No game executable or downloaded script is run. Source format reference:
// https://github.com/Galaxy1036/sc_decode/blob/master/sc_decode.py
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const commit = "7fc7687e6de74690e902543ee4b59f562121e225";
let root = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/`;
const cache = "/tmp/browser-royale-sprites";
await mkdir(cache, { recursive: true });
await mkdir("public/assets/sprites", { recursive: true });
await mkdir("reference/sc", { recursive: true });
const sources = {
  knight: "knight",
  archers: "archer",
  giant: "giant",
  musketeer: "musketeer",
  "mini-pekka": "mini_pekka",
  goblins: "goblin",
  "spear-goblins": "goblin_archer",
  skeletons: "skeleton",
  bomber: "bomber",
  valkyrie: "valkyrie",
  "hog-rider": "hog_rider",
  "baby-dragon": "baby_dragon",
  minions: "minion",
  witch: "witch",
  prince: "prince",
  pekka: "pekka",
  balloon: "balloon",
  wizard: "wizard",
};
async function download(path) {
  const local = cache + "/" + path.replaceAll("/", "__");
  try {
    return await readFile(local);
  } catch {}
  const r = await fetch(root + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(local, b);
  return b;
}
function parse(b) {
  let p = 17;
  const count = b.readUInt16LE(p);
  p += 2;
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(b.readUInt16LE(p));
    p += 2;
  }
  const exports = new Map();
  for (let i = 0; i < count; i++) {
    const len = b[p++];
    exports.set(ids[i], b.toString("utf8", p, p + len));
    p += len;
  }
  const shapes = new Map(),
    clips = [];
  let shapeIndex = 0;
  while (p + 5 <= b.length) {
    const tag = b[p],
      size = b.readUInt32LE(p + 1);
    const end = p + 5 + size;
    if (end > b.length) throw new Error("Invalid SC block boundary");
    let q = p + 5;
    if (tag === 18) shapes.set(b.readUInt16LE(q), shapeIndex++);
    if (tag === 12) {
      const id = b.readUInt16LE(q),
        fps = b[q + 2],
        frameCount = b.readUInt16LE(q + 3),
        n = b.readInt32LE(q + 5);
      q += 9;
      const refs = [];
      for (let i = 0; i < n; i++) {
        refs.push(b.readUInt16LE(q));
        q += 6;
      }
      const childCount = b.readUInt16LE(q);
      q += 2;
      const children = [];
      for (let i = 0; i < childCount; i++) {
        children.push(b.readUInt16LE(q));
        q += 2;
      }
      q += childCount;
      for (let i = 0; i < childCount; i++) {
        const len = b[q++];
        if (len < 255) q += len;
      }
      // Every frame tag records its display-list length. Flatten only single-shape frames.
      const frameSizes = [];
      while (q + 5 <= end) {
        const sub = b[q],
          len = b.readUInt32LE(q + 1);
        if (sub === 11) frameSizes.push(b.readUInt16LE(q + 5));
        q += 5 + len;
      }
      let offset = 0;
      const frames = frameSizes.map((length) => {
        const shape = length === 1 ? children[refs[offset]] : undefined;
        offset += length;
        return shape;
      });
      clips.push({
        name: exports.get(id) ?? `clip${id}`,
        fps,
        frameCount,
        frames,
      });
    }
    p = end;
    if (tag === 0) break;
  }
  return { exports, shapes, clips, shapeCount: b.readUInt16LE(0) };
}
const manifest = {
  source: "https://github.com/smlbiobot/cr",
  commit,
  files: [],
};
for (const [id, source] of Object.entries(sources)) {
  root = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/${id === "wizard" ? "1.8.0/com.supercell.clashroyale_1.8.0_unpack" : "1.8.1/com.supercell.clashroyale-1.8.1"}/assets/sc/`;
  const name = "chr_" + source;
  const metadata = await download(name);
  await writeFile(`reference/sc/${name}.bin`, metadata);
  const data = parse(metadata);
  const keys = {};
  for (const clip of data.clips) {
    const m = clip.name.match(
      /(?:^|_)(run|walk|attack|idle|hover|fly)(?:\d*)_(\d+)$/i,
    );
    if (!m) continue;
    const direction = Number(m[2]);
    if (![1, 3, 5, 7, 9].includes(direction)) continue;
    const red = /enemy|_red_/i.test(clip.name);
    const kind = /run|walk|hover|fly/i.test(m[1])
      ? "run"
      : /attack/i.test(m[1])
        ? "attack"
        : "idle";
    const key = `${red ? "red" : "blue"}-${kind}-${direction}`;
    const sequence = clip.frames
      .map((s) => data.shapes.get(s))
      .filter((s) => s !== undefined);
    if (!sequence.length) continue;
    const sampled =
      kind === "idle"
        ? [sequence[0]]
        : Array.from(
            { length: 4 },
            (_, i) => sequence[Math.floor((i * sequence.length) / 4)],
          );
    keys[key] = sampled;
  }
  const indices = [...new Set(Object.values(keys).flat())].sort(
    (a, b) => a - b,
  );
  if (!indices.length) {
    console.log(`No supported clips for ${id}`);
    continue;
  }
  const buffers = new Map();
  const digits = String(data.shapeCount).length;
  for (let i = 0; i < indices.length; i += 16)
    await Promise.all(
      indices.slice(i, i + 16).map(async (index) => {
        const path = `${name}_out/${name}_sprite_${String(index).padStart(digits, "0")}.png`;
        buffers.set(index, await download(path));
      }),
    );
  const example = await sharp(buffers.get(indices[0])).metadata();
  const cell = 128,
    cols = 8,
    rows = Math.ceil(indices.length / cols),
    width = 1024,
    height = 2 ** Math.ceil(Math.log2(rows * cell));
  const rects = {},
    composite = [];
  const originalWidth = example.width,
    originalHeight = example.height;
  const ratio = Math.min(cell / originalWidth, cell / originalHeight);
  const resizeW = Math.round(originalWidth * ratio),
    resizeH = Math.round(originalHeight * ratio);
  const offX = Math.floor((cell - resizeW) / 2),
    offY = Math.floor((cell - resizeH) / 2);
  // All decoded shapes in one SC family share registration. Use a stable idle foot anchor.
  const idleIndex =
    keys["blue-idle-9"]?.[0] ?? keys["blue-run-9"]?.[0] ?? indices[0];
  const idle = await sharp(buffers.get(idleIndex))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = originalWidth,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < idle.info.height; y++)
    for (let x = 0; x < idle.info.width; x++)
      if (idle.data[(y * idle.info.width + x) * 4 + 3] > 50) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  for (let i = 0; i < indices.length; i++) {
    const x = (i % cols) * cell,
      y = Math.floor(i / cols) * cell;
    const index = indices[i];
    const frame = await sharp(buffers.get(index))
      .resize(resizeW, resizeH)
      .png()
      .toBuffer();
    composite.push({ input: frame, left: x + offX, top: y + offY });
    rects[index] = [x, y, cell, cell];
  }
  const atlas = await sharp({
    create: { width, height, channels: 4, background: "#00000000" },
  })
    .composite(composite)
    .png({ palette: true, quality: 95 })
    .toBuffer();
  await writeFile(`public/assets/sprites/${id}.png`, atlas);
  const out = {
    width,
    height,
    cell,
    anchor: [
      (((minX + maxX) / 2) * ratio + offX) / cell,
      1 - ((maxY - 2) * ratio + offY) / cell,
    ],
    clips: keys,
    frames: rects,
  };
  await writeFile(`public/assets/sprites/${id}.json`, JSON.stringify(out));
  manifest.files.push({
    id,
    metadataSha256: createHash("sha256").update(metadata).digest("hex"),
    atlasSha256: createHash("sha256").update(atlas).digest("hex"),
    source: name,
    shapes: indices.length,
    clips: Object.keys(keys).length,
  });
  console.log(
    `${id}: ${indices.length} shapes, ${Object.keys(keys).length} clips, ${Math.round(atlas.length / 1024)} KB`,
  );
}
root = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/`;
// Import the complete arena and tower component shapes, with exact export identities.
for (const name of ["building_tower", "arena_training"]) {
  const metadata = await download(name);
  await writeFile(`reference/sc/${name}.bin`, metadata);
  const data = parse(metadata);
  const exportInfo = Object.fromEntries(
    data.clips.map((c) => [
      c.name,
      [
        ...new Set(
          c.frames
            .map((s) => data.shapes.get(s))
            .filter((s) => s !== undefined),
        ),
      ],
    ]),
  );
  await writeFile(
    `reference/sc/${name}.json`,
    JSON.stringify(exportInfo, null, 2),
  );
  const indices =
    name === "arena_training"
      ? Array.from({ length: data.shapeCount }, (_, i) => i)
      : [...new Set(Object.values(exportInfo).flat())];
  const dir = `public/assets/sprites/${name}`;
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < indices.length; i += 12)
    await Promise.all(
      indices.slice(i, i + 12).map(async (index) => {
        const b = await download(
          `${name}_out/${name}_sprite_${String(index).padStart(String(data.shapeCount).length, "0")}.png`,
        );
        await writeFile(`${dir}/${index}.png`, b);
      }),
    );
  console.log(name, exportInfo);
}
await writeFile(
  "public/assets/sprites/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
