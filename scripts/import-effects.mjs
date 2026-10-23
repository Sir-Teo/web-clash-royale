// Import original projectile orientations and authored electrical / impact clips.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";
const output = "public/assets/effects";
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

const commit = "7fc7687e6de74690e902543ee4b59f562121e225";
const directory = "apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/sc/";
const destructionBytes = await readFile("src/render/destruction-data.json");
const destruction = JSON.parse(destructionBytes);
const buildingsBytes = await readFile("reference/logic/buildings.csv");
const balloon = csvRows(buildingsBytes.toString()).find(
  (r) => r.Name === "BalloonBomb",
);
if (balloon.FileName !== "sc/building_mega_bomb.sc")
  throw new Error("Unexpected Balloon bomb resource");
const textures = [],
  hashes = [],
  sources = [],
  shapes = {};

const frames = [],
  frameLookup = new Map(),
  clips = {};
for (const resource of ["effects", "building_mega_bomb"]) {
  const path = `reference/sc/${resource}.bin`,
    metadata = await readFile(path),
    data = parseSC(metadata);
  const usedShapes = new Set(),
    shapeOffset = Object.keys(shapes).length
      ? Math.max(...Object.keys(shapes).map(Number)) + 1
      : 0;
  const textureOffset = textures.length;
  sources.push({
    path,
    source: `${directory}${resource}`,
    sha256: sha256(metadata),
  });
  function flatten(
    ref,
    frame,
    matrix = identity,
    color = neutral,
    depth = 0,
    blend = 0,
  ) {
    if (depth > 20) throw new Error(`Recursive SC display list ${resource}`);
    if (data.shapes[ref]) {
      usedShapes.add(ref);
      return [
        {
          shape: ref + shapeOffset,
          matrix: matrix.map(round),
          color: color.map(round),
          ...(blend ? { blend } : {}),
        },
      ];
    }
    const clip = data.clips[ref];
    if (!clip?.frames.length)
      throw new Error(`Missing SC child ${ref} in ${resource}`);
    return clip.frames[frame % clip.frames.length].flatMap((child) => {
      if (![0, 3, 4, 8].includes(child.blend))
        throw new Error(
          `Unsupported effect blend mode ${child.blend} in ${ref}`,
        );
      return flatten(
        child.id,
        frame,
        multiply(matrix, data.matrices[child.matrix] ?? identity),
        composeColor(color, data.colors[child.color] ?? neutral),
        depth + 1,
        child.blend || blend,
      );
    });
  }

  const emitterExports = [
    ...new Set(Object.values(destruction.emitters).flatMap((e) => e.clips)),
  ].filter((name) => data.names[name] !== undefined);
  const exports =
    resource === "effects"
      ? [
          ...new Set([
            "projectile_arrow_basic",
            "projectile_arrow_basic_enemy",
            "projectile_spear_360",
            "projectile_bomb",
            "projectile_cannonball_large",
            "projectile_cannonball_small",
            "dragon_projectile",
            "Tower_projectile1",
            "fireball_small",
            "fireball_projectile1",
            "tesla_beam",
            "zap_bolt1",
            "lightning_bolt",
            "effect_Hit1",
            "ExplosionGroundGlowBlue",
            "fireball_trail1",
            "explosion_cloud_1",
            "Smoke_puff_01",
            "crown_rotate_anim",
            ...emitterExports,
          ]),
        ]
      : [balloon.BlueExportName, balloon.RedExportName, ...emitterExports];
  for (const name of exports) {
    const ref = data.names[name],
      source = data.clips[ref];
    if (!source?.frames.length) throw new Error(`Missing effect ${name}`);
    const sequence = source.frames.map((_, i) => {
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
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of [...new Set(sequence)].flatMap((index) => frames[index]))
      for (const polygon of data.shapes[part.shape - shapeOffset])
        for (const [x, y] of polygon.xy) {
          const m = part.matrix,
            px = m[0] * x + m[2] * y + m[4],
            py = m[1] * x + m[3] * y + m[5];
          bounds[0] = Math.min(bounds[0], px);
          bounds[1] = Math.min(bounds[1], py);
          bounds[2] = Math.max(bounds[2], px);
          bounds[3] = Math.max(bounds[3], py);
        }
    if (clips[name]) throw new Error(`Duplicate effect export ${name}`);
    clips[name] = {
      source: name,
      fps: source.fps,
      frames: sequence,
      bounds,
      ...(resource === "building_mega_bomb" ? { labels: source.labels } : {}),
    };
    console.log(
      name,
      sequence.length,
      bounds.map((v) => Math.round(v)),
    );
  }
  for (let i = 0; i < data.textures.length; i++) {
    const name = `${resource}_tex${"_".repeat(i)}.png`,
      path = `/tmp/browser-royale-sprites/${name}`;
    let original;
    try {
      original = await readFile(path);
    } catch {
      const r = await fetch(
        `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/${directory}${name}`,
      );
      if (!r.ok) throw new Error(`Missing effects texture ${r.status}`);
      original = Buffer.from(await r.arrayBuffer());
    }
    const texture = await sharp(original)
        .webp({ lossless: true, effort: 6 })
        .toBuffer(),
      file = `${resource}-${i}.webp`;
    await writeFile(`${output}/${file}`, texture);
    const info = await sharp(texture).metadata();
    textures.push({ file, width: info.width, height: info.height });
    hashes.push({
      file,
      sha256: sha256(texture),
      originalSha256: sha256(original),
      source: `${directory}${name}`,
    });
  }
  Object.assign(
    shapes,
    Object.fromEntries(
      [...usedShapes].map((ref) => [
        ref + shapeOffset,
        data.shapes[ref].map((p) => ({
          sheet: p.sheet + textureOffset,
          xy: p.xy.map((p) => p.map(round)),
          uv: p.uv.map((p) => p.map(round)),
        })),
      ]),
    ),
  );
}
for (const emitter of Object.values(destruction.emitters))
  for (const name of emitter.clips)
    if (!clips[name]) throw new Error(`Unresolved effect export ${name}`);
const out = {
  version: 2,
  textures,
  bounds: [-30, -30, 30, 30],
  anchor: [0, 0],
  shapes,
  clips,
  frames,
};
const json = JSON.stringify(out);
await writeFile(`${output}/effects.json`, json);
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      version: "1.8.0",
      metadataSha256: sources[0].sha256,
      sources,
      inputs: [
        {
          path: "src/render/destruction-data.json",
          sha256: sha256(destructionBytes),
        },
        {
          path: "reference/logic/buildings.csv",
          sha256: sha256(buildingsBytes),
        },
      ],
      dataSha256: sha256(json),
      textures: hashes,
      clips: Object.keys(clips).length,
      frames: frames.length,
    },
    null,
    2,
  ) + "\n",
);
