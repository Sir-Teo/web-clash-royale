// Preserve full SC1 animations, source UV polygons, transforms and native textures.
// Reconstructs static data only; no original game code is executed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
const commit = "7fc7687e6de74690e902543ee4b59f562121e225";
const cache = "/tmp/browser-royale-sprites";
const output = "public/assets/animations";
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const sources = {
  knight: "knight",
  barbarians: "barbarian",
  "royal-giant": "royal_giant",
  "mega-minion": "mega_minion",
  "dart-goblin": "goblin_blowdart",
  "ice-wizard": "ice_wizard",
  princess: "princess",
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
  "tower-princess": "princess",
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const neutral = [0, 0, 0, 255, 255, 255, 255];
const composeColor = (parent, child) => [
  ...[0, 1, 2].map((i) => Math.min(255, parent[i] + child[i])),
  (parent[3] * child[3]) / 255,
  ...[4, 5, 6].map((i) => (parent[i] * child[i]) / 255),
];
const round = (n) => Math.round(n * 100000) / 100000;
async function download(base, path) {
  const local = `${cache}/${path}`;
  try {
    return await readFile(local);
  } catch {}
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(local, b);
  return b;
}
const manifest = {
  version: 2,
  source: "https://github.com/smlbiobot/cr",
  commit,
  files: [],
};
for (const [id, source] of Object.entries(sources)) {
  const name = `chr_${source}`;
  const version =
    id === "wizard"
      ? "1.8.0/com.supercell.clashroyale_1.8.0_unpack"
      : "1.8.1/com.supercell.clashroyale-1.8.1";
  const base = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/${version}/assets/sc/`;
  const metadata = await readFile(`reference/sc/${name}.bin`);
  const data = parseSC(metadata);
  const frames = [],
    frameLookup = new Map(),
    clips = {},
    usedShapes = new Set();
  function flatten(ref, frame, matrix = identity, color = neutral, depth = 0) {
    if (depth > 20) throw new Error(`Recursive SC display list ${name}`);
    if (data.shapes[ref]) {
      usedShapes.add(ref);
      return [
        { shape: ref, matrix: matrix.map(round), color: color.map(round) },
      ];
    }
    const clip = data.clips[ref];
    if (!clip?.frames.length)
      throw new Error(`Missing SC child ${ref} in ${name}`);
    return clip.frames[frame % clip.frames.length].flatMap((child) =>
      flatten(
        child.id,
        frame,
        multiply(matrix, data.matrices[child.matrix] ?? identity),
        composeColor(color, data.colors[child.color] ?? neutral),
        depth + 1,
      ),
    );
  }
  for (const [exportName, ref] of Object.entries(data.names)) {
    const match = exportName.match(
      /(?:^|_)(run|walk|attack|idle|hover|fly|charge)(\d*)_(\d+)$/i,
    );
    if (!match || Number(match[2] || 1) > 1) continue;
    // This source also contains Inferno Dragon exports. Never overwrite Baby Dragon.
    if (id === "baby-dragon" && !exportName.startsWith("baby_dragon_"))
      continue;
    if (id === "barbarians" && !exportName.startsWith("barbarian1_")) continue;
    if (id === "tower-princess" && !exportName.startsWith("princess_tower_"))
      continue;
    if (id === "princess" && !exportName.startsWith("princess_")) continue;
    if (id === "princess" && exportName.startsWith("princess_tower_")) continue;
    const direction = Number(match[3]);
    if (direction < 1 || direction > 9) continue;
    const hasExplicitBlue = Object.keys(data.names).some((name) =>
      /_blue_/i.test(name),
    );
    const team =
      /enemy|_red_/i.test(exportName) ||
      (hasExplicitBlue && !/_blue_/i.test(exportName))
        ? "red"
        : "blue";
    const kind = /run|walk|hover|fly/i.test(match[1])
      ? "run"
      : match[1].toLowerCase();
    const sourceClip = data.clips[ref];
    if (!sourceClip?.frames.length)
      throw new Error(`Missing export ${exportName}`);
    // The archived blue Princess run direction 9 is an authored empty export.
    // Use adjacent direction 8 so the troop stays visible on that heading.
    const emptyPrincessRun =
      id === "princess" && exportName === "princess_run1_9";
    if (
      emptyPrincessRun &&
      !sourceClip.frames.every((frame) => frame.length === 0)
    )
      throw new Error("Recheck empty archived Princess run direction 9");
    const drawnName = emptyPrincessRun ? "princess_run1_8" : exportName;
    const drawnRef = data.names[drawnName];
    const drawnClip = data.clips[drawnRef];
    const sequence = drawnClip.frames.map((_, index) => {
      const parts = flatten(drawnRef, index);
      const key = JSON.stringify(parts);
      let frame = frameLookup.get(key);
      if (frame === undefined) {
        frame = frames.length;
        frames.push(parts);
        frameLookup.set(key, frame);
      }
      return frame;
    });
    if (clips[`${team}-${kind}-${direction}`])
      throw new Error(`Duplicate animation key ${id}: ${exportName}`);
    clips[`${team}-${kind}-${direction}`] = {
      fps: drawnClip.fps,
      frames: sequence,
      source: drawnName,
      ...(emptyPrincessRun ? { emptySource: exportName } : {}),
    };
  }
  const textures = [],
    hashes = [];
  for (let i = 0; i < data.textures.length; i++) {
    const original = await download(
      base,
      id === "tower-princess" ||
        id === "princess" ||
        id === "royal-giant" ||
        id === "mega-minion" ||
        id === "dart-goblin"
        ? `${name}_highres_tex.png`
        : `${name}_tex${"_".repeat(i)}.png`,
    );
    const texture = await sharp(original)
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    const file = `${id}-${i}.webp`;
    await writeFile(`${output}/${file}`, texture);
    const info = await sharp(texture).metadata();
    textures.push({ file, width: info.width, height: info.height });
    hashes.push({
      file,
      sha256: sha256(texture),
      originalSha256: sha256(original),
    });
  }
  const shapes = Object.fromEntries(
    [...usedShapes].map((ref) => [
      ref,
      data.shapes[ref].map((p) => ({
        sheet: p.sheet,
        xy: p.xy.map((p) => p.map(round)),
        uv: p.uv.map((p) => p.map(round)),
      })),
    ]),
  );
  const idle =
    clips["blue-idle-9"] ?? clips["blue-idle-1"] ?? Object.values(clips)[0];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of frames[idle.frames[0]])
    for (const polygon of shapes[part.shape])
      for (const [x, y] of polygon.xy) {
        const m = part.matrix,
          px = m[0] * x + m[2] * y + m[4],
          py = m[1] * x + m[3] * y + m[5];
        bounds[0] = Math.min(bounds[0], px);
        bounds[1] = Math.min(bounds[1], py);
        bounds[2] = Math.max(bounds[2], px);
        bounds[3] = Math.max(bounds[3], py);
      }
  const out = {
    version: 2,
    textures,
    bounds,
    anchor:
      id === "tower-princess"
        ? [0, 0]
        : [(bounds[0] + bounds[2]) / 2, bounds[3] - 2],
    shapes,
    clips,
    frames,
  };
  const json = JSON.stringify(out);
  await writeFile(`${output}/${id}.json`, json);
  const totalFrames = Object.values(clips).reduce(
    (sum, clip) => sum + clip.frames.length,
    0,
  );
  manifest.files.push({
    id,
    source: name,
    metadataSha256: sha256(metadata),
    dataSha256: sha256(json),
    textures: hashes,
    shapes: usedShapes.size,
    clips: Object.keys(clips).length,
    frames: totalFrames,
    uniqueFrames: frames.length,
  });
  console.log(
    `${id}: ${Object.keys(clips).length} clips, ${totalFrames} frames (${frames.length} unique), ${usedShapes.size} shapes`,
  );
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
