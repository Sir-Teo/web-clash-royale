// Preserve original building state labels and directional display lists.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
const output = "public/assets/buildings";
await mkdir(output, { recursive: true });
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

const manifest = {
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  version: "1.8.1",
  files: [],
};
for (const [id, name] of Object.entries({
  tesla: "building_tesla",
  cannon: "building_basic_cannon",
})) {
  const metadata = await readFile(`reference/sc/${name}.bin`),
    data = parseSC(metadata);
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

  for (const [exp, ref] of Object.entries(data.names)) {
    const team = /red|enemy/.test(exp) ? "red" : "blue",
      clip = data.clips[ref];
    const sequence = clip.frames.map((_, i) => {
      const parts = flatten(ref, i),
        key = JSON.stringify(parts);
      let index = frameLookup.get(key);
      if (index === undefined) {
        index = frames.length;
        frames.push(parts);
        frameLookup.set(key, index);
      }
      return index;
    });
    clips[team] = {
      source: exp,
      fps: clip.fps,
      frames: sequence,
      labels: clip.labels,
    };
  }
  const bounds = JSON.parse(
    await readFile(`reference/sc/${id}-blue.json`, "utf8"),
  ).bounds;
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
  const textures = [],
    hashes = [];
  for (let i = 0; i < data.textures.length; i++) {
    const filename = `${name}_tex${"_".repeat(i)}.png`;
    let original;
    try {
      original = await readFile(`/tmp/browser-royale-sprites/${filename}`);
    } catch {
      const response = await fetch(
        `https://raw.githubusercontent.com/smlbiobot/cr/${manifest.commit}/apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/${filename}`,
      );
      if (!response.ok)
        throw new Error(
          `Missing building texture ${filename}: ${response.status}`,
        );
      original = Buffer.from(await response.arrayBuffer());
    }
    const texture = await sharp(original)
        .webp({ lossless: true, effort: 6 })
        .toBuffer(),
      file = `${id}-${i}.webp`;
    await writeFile(`${output}/${file}`, texture);
    const info = await sharp(texture).metadata();
    textures.push({ file, width: info.width, height: info.height });
    hashes.push({
      file,
      sha256: sha256(texture),
      originalSha256: sha256(original),
    });
  }
  const json = JSON.stringify({
    version: 2,
    textures,
    bounds,
    anchor: [0, 0],
    shapes,
    clips,
    frames,
  });
  await writeFile(`${output}/${id}.json`, json);
  manifest.files.push({
    id,
    source: name,
    metadataSha256: sha256(metadata),
    dataSha256: sha256(json),
    textures: hashes,
    frames: frames.length,
  });
  console.log(
    id,
    Object.fromEntries(
      Object.entries(clips).map(([team, c]) => [
        team,
        { frames: c.frames.length, labels: c.labels },
      ]),
    ),
  );
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
