// Retain original health HUD roots, independently selected fill states and source profiles.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";
const output = "public/assets/ui/health";
await mkdir(output, { recursive: true });
const data = parseSC(await readFile("reference/sc/ui.bin"));
const sourceManifest = JSON.parse(
  await readFile("public/assets/ui/manifest.json", "utf8"),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
let texture;
try {
  texture = await readFile("/tmp/royale-native-ui-texture.png");
} catch {
  const r = await fetch(
    `https://raw.githubusercontent.com/smlbiobot/cr/${sourceManifest.commit}/apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/sc/ui_tex.png`,
  );
  if (!r.ok) throw new Error(`UI atlas: ${r.status}`);
  texture = Buffer.from(await r.arrayBuffer());
}
if (
  hash(texture) !==
  sourceManifest.sources.find((s) => s.source === "sc/ui_tex.png").sha256
)
  throw new Error("Native UI texture hash mismatch");
const identity = [1, 0, 0, 1, 0, 0],
  neutral = [0, 0, 0, 255, 255, 255, 255];
const round = (n) => Math.round(n * 100000) / 100000;
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const tint = (a, b) => [
  ...[0, 1, 2].map((i) => Math.min(255, a[i] + b[i])),
  (a[3] * b[3]) / 255,
  ...[4, 5, 6].map((i) => (a[i] * b[i]) / 255),
];
const texts = {},
  usedShapes = new Set(),
  translations = { level: "11", "hpNumber/txt": "3052" };
const slots = new Set();
function flatten(
  id,
  frame,
  path = "",
  matrix = identity,
  color = neutral,
  depth = 0,
) {
  if (depth > 20) throw new Error("Recursive health display list");
  const name = path.split("/").at(-1);
  if (name === "buff" || name === "ammo") return [];
  if (slots.has(id))
    return [
      {
        shape: -1,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  if (data.texts[id]) {
    texts[id] = data.texts[id];
    translations[path] ??= "";
    return [
      {
        text: id,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  }
  if (data.shapes[id]) {
    usedShapes.add(id);
    return [
      {
        shape: id,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  }
  const c = data.clips[id];
  if (!c?.frames.length) throw new Error(`Missing health child ${id}`);
  return c.frames[frame % c.frames.length].flatMap((child) => {
    const name = c.children[child.child]?.name;
    return flatten(
      child.id,
      frame,
      [path, name].filter(Boolean).join("/"),
      multiply(matrix, data.matrices[child.matrix] ?? identity),
      tint(color, data.colors[child.color] ?? neutral),
      depth + 1,
    );
  });
}
const roots = {};
for (const side of ["player", "enemy"])
  for (const kind of [
    "small",
    "medium",
    "high",
    "number",
    "tower_withNumber",
    "wizard",
  ]) {
    const name = `hp_${side}_${kind}`,
      id = data.names[name];
    if (!id) throw new Error(`Missing health root ${name}`);
    const bar = data.clips[id].children.find((c) => c.name === "bar");
    roots[name] = { id, barId: bar?.id };
    if (bar) slots.add(bar.id);
  }
for (const side of ["player", "enemy"])
  for (const kind of ["medium", "number"]) {
    const name = `hp_shield_${side}_${kind}`,
      id = data.names[name];
    if (!id) throw new Error(`Missing native shield health root ${name}`);
    const bar = data.clips[id].children.find((c) => c.name === "bar");
    roots[name] = { id, barId: bar?.id };
    if (bar) slots.add(bar.id);
  }
const clips = {},
  bars = {};
for (const [name, { id, barId }] of Object.entries(roots)) {
  const c = data.clips[id];
  clips[name] = {
    sourceId: id,
    fps: c.fps,
    labels: c.labels,
    frames: c.frames.map((_, frame) => flatten(id, frame)),
  };
  if (barId) {
    slots.delete(barId);
    const bar = data.clips[barId];
    const key = `${name}_bar`;
    clips[key] = {
      sourceId: barId,
      fps: bar.fps,
      labels: bar.labels,
      frames: bar.frames.map((_, frame) => flatten(barId, frame)),
    };
    bars[name] = key;
    slots.add(barId);
  }
}
const shapes = {},
  files = [];
const [sheetWidth, sheetHeight] = data.textures[0];
for (const id of usedShapes) {
  const polygons = [];
  for (const [index, p] of data.shapes[id].entries()) {
    if (p.sheet !== 0) throw new Error(`Unexpected health atlas ${p.sheet}`);
    const u = p.uv.map((v) => v[0] * sheetWidth),
      v = p.uv.map((v) => v[1] * sheetHeight);
    if (new Set(p.uv.map((v) => v.join(","))).size === 1) {
      const pixel = await sharp(texture)
        .ensureAlpha()
        .extract({
          left: Math.floor(u[0]),
          top: Math.floor(v[0]),
          width: 1,
          height: 1,
        })
        .raw()
        .toBuffer();
      polygons.push({
        xy: p.xy,
        uv: p.uv,
        solid:
          ((pixel[3] << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]) >>>
          0,
      });
      continue;
    }
    const left = Math.floor(Math.min(...u)),
      top = Math.floor(Math.min(...v));
    const width = Math.min(sheetWidth - left, Math.ceil(Math.max(...u)) - left),
      height = Math.min(sheetHeight - top, Math.ceil(Math.max(...v)) - top);
    const file = `shape-${id}-${index}.webp`;
    const image = await sharp(texture)
      .extract({ left, top, width, height })
      .webp({ lossless: true })
      .toBuffer();
    await writeFile(`${output}/${file}`, image);
    files.push({ file, bytes: image.length, sha256: hash(image) });
    polygons.push({
      file,
      width,
      height,
      xy: p.xy,
      uv: p.uv.map(([x, y]) => [
        round(x * sheetWidth - left),
        round(y * sheetHeight - top),
      ]),
    });
  }
  shapes[id] = { polygons };
}
const profiles = {};
const mapping = JSON.parse(await readFile("src/game/combat-data.json", "utf8"));
const tables = {},
  addedSources = [
    {
      path: "src/game/combat-data.json",
      source: "browser card-to-character mapping",
      sha256: hash(await readFile("src/game/combat-data.json")),
    },
  ];
for (const name of ["characters", "buildings"]) {
  const path = `reference/logic/${name}.csv`,
    bytes = await readFile(path);
  tables[name] = Object.fromEntries(
    csvRows(bytes.toString()).map((r) => [r.Name, r]),
  );
  addedSources.push({
    path,
    source: `csv_logic/${name}.decoded.csv`,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
for (const [id, combat] of Object.entries(mapping)) {
  const table = tables.characters[combat.source] ? "characters" : "buildings",
    row = tables[table][combat.source];
  if (!row) throw new Error(`Missing health profile ${id}`);
  profiles[id] = {
    source: row.Name,
    table,
    healthBar: row.HealthBar,
    offsetY: Number(row.HealthBarOffsetY),
    showNumber: row.ShowHealthNumber === "true",
  };
}
// A single small atlas keeps each troop HUD to one texture/material.
const regions = {},
  padding = 2,
  atlasWidth = 512;
let x = padding,
  y = padding,
  rowHeight = 0;
const composites = [];
for (const f of files) {
  const image = await readFile(`${output}/${f.file}`),
    meta = await sharp(image).metadata();
  if (x + meta.width + padding > atlasWidth) {
    x = padding;
    y += rowHeight + padding;
    rowHeight = 0;
  }
  regions[f.file] = [x, y, meta.width, meta.height];
  composites.push({ input: image, left: x, top: y });
  x += meta.width + padding;
  rowHeight = Math.max(rowHeight, meta.height);
}
const imageHeight = y + rowHeight + padding,
  atlasHeight = Math.ceil((imageHeight + 64) / 64) * 64;
const atlasImage = await sharp({
  create: {
    width: atlasWidth,
    height: atlasHeight,
    channels: 4,
    background: "#00000000",
  },
})
  .composite(composites)
  .webp({ lossless: true })
  .toBuffer();
await writeFile(`${output}/atlas.webp`, atlasImage);
files.push({
  file: "atlas.webp",
  bytes: atlasImage.length,
  sha256: hash(atlasImage),
});
const atlas = {
  file: "atlas.webp",
  width: atlasWidth,
  height: atlasHeight,
  regions,
  textY: imageHeight,
};
const json = JSON.stringify({
  clips,
  bars,
  texts,
  shapes,
  translations,
  profiles,
  atlas,
  audio: {},
});
await writeFile(`${output}/health.json`, json);
files.push({
  file: "health.json",
  bytes: Buffer.byteLength(json),
  sha256: hash(json),
});
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: sourceManifest.source,
      commit: sourceManifest.commit,
      sources: [
        ...sourceManifest.sources.filter(
          (s) => s.source !== "csv_client/sounds.decoded.csv",
        ),
        ...addedSources,
      ],
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(roots).length} health roots, ${Object.keys(bars).length} fill timelines, ${usedShapes.size} shapes, ${Object.keys(texts).length} text styles and ${Object.keys(profiles).length} profiles.`,
);
