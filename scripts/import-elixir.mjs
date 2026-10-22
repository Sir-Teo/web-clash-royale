// Retain the native battle elixir controls and their complete feedback clips.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";
const output = "public/assets/ui/elixir";
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
const dictionary = Object.fromEntries(
  csvRows((await readFile("reference/client/texts.csv")).toString()).map(
    (r) => [r[" "], r.EN],
  ),
);
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
  translations = {
    "elixirBarLeftNumbers/elixirAmount/txt": "5",
    "elixirBarLeftNumbers/TID_MAX_ELIXIR/TID_MAX_ELIXIR":
      dictionary.TID_MAX_ELIXIR.replace("<MAX_MANA>", "10"),
    "txt_anim/TID_MANA_BAR_FULL_NOTIFICATION_vcenter":
      dictionary.TID_MANA_BAR_FULL_NOTIFICATION,
    "icon/txt": "-3",
    "elixirRegen/elixir/txt": "x2",
  };
function flatten(
  id,
  frame,
  path = "",
  matrix = identity,
  color = neutral,
  depth = 0,
) {
  if (depth > 20) throw new Error("Recursive elixir display list");
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
  if (!c?.frames.length) throw new Error(`Missing elixir child ${id}`);
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
const player = data.clips[data.names.HUD_player];
const barId = player.children.find((c) => c.name === "elixir_bar").id;
const warningId = player.children.find((c) => c.name === "elixir_warning").id;
const bar = data.clips[barId];
const child = (name) => {
  const index = bar.children.findIndex((c) => c.name === name);
  const ref = bar.frames[0].find((p) => p.child === index);
  return { id: ref.id, matrix: data.matrices[ref.matrix] ?? identity };
};
const exports = {
  elixir_bar: { id: barId },
  elixir_requirement: child("elixirRequirementBar"),
  elixir_tip: child("bar_tip"),
  elixir_flow: child("bar_flow"),
  elixir_warning: { id: warningId },
  Elixir_bar_drop_anim: { id: data.names.Elixir_bar_drop_anim },
  elixir_float_txt: { id: data.names.elixir_float_txt },
  HUD_topRight_double_elixir: { id: data.names.HUD_topRight_double_elixir },
};
const clips = {};
for (const [name, { id, matrix }] of Object.entries(exports)) {
  const clip = data.clips[id];
  clips[name] = {
    sourceId: id,
    fps: clip.fps,
    labels: clip.labels,
    frames: clip.frames.map((_, frame) => flatten(id, frame, "", matrix)),
  };
}
const shapes = {},
  files = [];
const [sheetWidth, sheetHeight] = data.textures[0];
for (const id of usedShapes) {
  const polygons = [];
  for (const [index, p] of data.shapes[id].entries()) {
    if (p.sheet !== 0) throw new Error(`Unexpected elixir atlas ${p.sheet}`);
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
const json = JSON.stringify({ clips, texts, shapes, translations, audio: {} });
await writeFile(`${output}/elixir.json`, json);
files.push({
  file: "elixir.json",
  bytes: Buffer.byteLength(json),
  sha256: hash(json),
});
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: sourceManifest.source,
      commit: sourceManifest.commit,
      sources: sourceManifest.sources.filter(
        (s) => s.source !== "csv_client/sounds.decoded.csv",
      ),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(clips).length} elixir clips, ${Object.keys(texts).length} text styles, ${usedShapes.size} shapes.`,
);
