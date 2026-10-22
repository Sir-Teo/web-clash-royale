// Retain the archived battle announcements, including text fields and timelines.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const commit = "7fc7687e6de74690e902543ee4b59f562121e225";
const root = `https://raw.githubusercontent.com/smlbiobot/cr/${commit}/apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/`;
const output = "public/assets/ui";
const hash = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(output, { recursive: true });
await mkdir("reference/client", { recursive: true });
const sources = [];
async function source(path, local) {
  let data;
  try {
    data = await readFile(local);
  } catch {
    const response = await fetch(root + path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    await writeFile(local, data);
  }
  sources.push({
    source: path,
    ...(local.startsWith("/tmp/") ? {} : { path: local }),
    bytes: data.length,
    sha256: hash(data),
  });
  return data;
}
const [metadata, table, sounds, texture, font] = await Promise.all([
  source("sc/ui", "reference/sc/ui.bin"),
  source("csv_client/texts.decoded.csv", "reference/client/texts.csv"),
  source("csv_client/sounds.decoded.csv", "reference/client/sounds.csv"),
  source("sc/ui_tex.png", "/tmp/royale-native-ui-texture.png"),
  source("font/supercell-magic_0.ttf", `${output}/supercell-magic.ttf`),
]);
const data = parseSC(metadata);
const dictionary = Object.fromEntries(
  csvRows(table.toString()).map((r) => [r[" "], r.EN]),
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
const usedTexts = new Set(),
  usedShapes = new Set(),
  translations = {};
function flatten(
  id,
  frame,
  binding = "",
  matrix = identity,
  color = neutral,
  depth = 0,
) {
  if (depth > 20) throw new Error("Recursive UI display list");
  if (data.texts[id]) {
    usedTexts.add(id);
    if (!binding) throw new Error(`Unbound text ${id}`);
    translations[binding] = /^COUNTDOWN_/.test(binding)
      ? binding.slice(10)
      : dictionary[binding];
    if (translations[binding] === undefined)
      throw new Error(`Unknown text ${binding}`);
    return [
      { text: id, binding, matrix: matrix.map(round), color: color.map(round) },
    ];
  }
  if (data.shapes[id]) {
    usedShapes.add(id);
    return [{ shape: id, matrix: matrix.map(round), color: color.map(round) }];
  }
  const clip = data.clips[id];
  if (!clip?.frames.length) throw new Error(`Unknown UI child ${id}`);
  return clip.frames[frame % clip.frames.length].flatMap((child) => {
    const name = clip.children.find((c) => c.id === child.id)?.name;
    return flatten(
      child.id,
      frame,
      binding || (name?.startsWith("TID_") ? name : ""),
      multiply(matrix, data.matrices[child.matrix] ?? identity),
      tint(color, data.colors[child.color] ?? neutral),
      depth + 1,
    );
  });
}
const clips = {};
for (const name of [
  "print_endTimer",
  "print_30secondsLeft",
  "print_60secondsLeft",
  "print_60secondsLeft_overtime",
  "print_extra_time",
]) {
  const clip = data.clips[data.names[name]];
  const frames = clip.frames.map((refs, frame) =>
    refs.flatMap((child) => {
      const index = clip.children.findIndex((c) => c.id === child.id);
      // The exported countdown leaves 10–5 as identical placeholder TIDs.
      const binding =
        name === "print_endTimer" && index > 0 ? `COUNTDOWN_${11 - index}` : "";
      return flatten(
        child.id,
        frame,
        binding,
        data.matrices[child.matrix] ?? identity,
        data.colors[child.color] ?? neutral,
      );
    }),
  );
  clips[name] = { fps: clip.fps, frames };
}
const texts = Object.fromEntries(
  [...usedTexts].map((id) => [id, data.texts[id]]),
);
const shapes = {},
  files = [];
const [sheetWidth, sheetHeight] = data.textures[0];
for (const id of usedShapes) {
  const polygons = data.shapes[id];
  if (polygons.length !== 1 || polygons[0].sheet !== 0)
    throw new Error(`Unexpected announcement shape ${id}`);
  const { xy, uv } = polygons[0];
  const u = uv.map((v) => v[0] * sheetWidth),
    v = uv.map((v) => v[1] * sheetHeight);
  const left = Math.floor(Math.min(...u)),
    top = Math.floor(Math.min(...v));
  const width = Math.ceil(Math.max(...u)) - left,
    height = Math.ceil(Math.max(...v)) - top;
  const file = `shape-${id}.webp`;
  const image = await sharp(texture)
    .extract({ left, top, width, height })
    .webp({ lossless: true })
    .toBuffer();
  await writeFile(`${output}/${file}`, image);
  files.push({ file, bytes: image.length, sha256: hash(image) });
  shapes[id] = {
    file,
    width,
    height,
    xy,
    uv: uv.map(([x, y]) => [
      round(x * sheetWidth - left),
      round(y * sheetHeight - top),
    ]),
  };
}
const audio = Object.fromEntries(
  csvRows(sounds.toString())
    .filter(
      (r) =>
        /^Countdown_\d+$/.test(r.Name) ||
        ["sound_extra_time_jingle", "match start", "Gameend Horn"].includes(
          r.Name,
        ),
    )
    .map((r) => [
      r.Name,
      {
        file: r.FileNames.replace(/^sfx\//, "").replace(/\.wav$/, ""),
        volume: Number(r.MaxVolume) / 100,
      },
    ]),
);
const json = JSON.stringify({ clips, texts, translations, shapes, audio });
await writeFile(`${output}/announcements.json`, json);
files.push({
  file: "announcements.json",
  bytes: Buffer.byteLength(json),
  sha256: hash(json),
});
files.push({
  file: "supercell-magic.ttf",
  bytes: font.length,
  sha256: hash(font),
});
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit,
      sources: sources.sort((a, b) => a.source.localeCompare(b.source)),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(clips).length} native announcement clips, ${usedTexts.size} text styles, ${usedShapes.size} shape and ${Object.keys(audio).length} audio mappings.`,
);
