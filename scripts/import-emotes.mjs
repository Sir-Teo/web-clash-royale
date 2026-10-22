// Retain the four original King expressions, their complete nested timelines,
// both speech-bubble masters, and the original selector-button artwork.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const output = "public/assets/ui/emotes";
await mkdir(output, { recursive: true });
const data = parseSC(await readFile("reference/sc/ui.bin"));
const source = JSON.parse(
  await readFile("public/assets/ui/manifest.json", "utf8"),
);
const sounds = JSON.parse(
  await readFile("public/assets/manifest.json", "utf8"),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
let texture;
try {
  texture = await readFile("/tmp/royale-native-ui-texture.png");
} catch {
  const r = await fetch(
    `https://raw.githubusercontent.com/smlbiobot/cr/${source.commit}/apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/sc/ui_tex.png`,
  );
  if (!r.ok) throw new Error(`UI atlas: ${r.status}`);
  texture = Buffer.from(await r.arrayBuffer());
}
if (
  hash(texture) !==
  source.sources.find((s) => s.source === "sc/ui_tex.png").sha256
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
  ...[0, 1, 2].map((i) => Math.min(255, a[i] + (b[i] * a[i + 4]) / 255)),
  (a[3] * b[3]) / 255,
  ...[4, 5, 6].map((i) => (a[i] * b[i]) / 255),
];
const used = new Set();
function flatten(
  id,
  frame,
  path = "",
  matrix = identity,
  color = neutral,
  depth = 0,
) {
  if (depth > 20) throw new Error("Recursive emote display list");
  const binding = path.split("/").at(-1);
  const placeholder = binding === "anim" ? -1 : binding === "image" ? -2 : null;
  if (placeholder !== null || data.shapes[id]) {
    if (placeholder === null) used.add(id);
    return [
      {
        shape: placeholder ?? id,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  }
  const clip = data.clips[id];
  if (!clip?.frames.length) throw new Error(`Missing emote child ${id}`);
  return clip.frames[frame % clip.frames.length].flatMap((child) =>
    flatten(
      child.id,
      frame,
      [path, clip.children[child.child]?.name].filter(Boolean).join("/"),
      multiply(matrix, data.matrices[child.matrix] ?? identity),
      tint(color, data.colors[child.color] ?? neutral),
      depth + 1,
    ),
  );
}
const clips = {},
  settings = { expressions: {}, bubbles: {} };
for (const [kind, name] of Object.entries({
  laugh: "lol",
  cry: "cry",
  angry: "angry",
  thumbs: "thumbs",
})) {
  const id = data.names[`sticker_${name}_anim`],
    wrapper = data.clips[id];
  const child = wrapper.children[0].id,
    timeline = data.clips[child];
  if (wrapper.frames.length !== 1 || wrapper.fps !== timeline.fps)
    throw new Error(`Unexpected ${kind} wrapper`);
  clips[kind] = {
    sourceId: id,
    timelineId: child,
    fps: timeline.fps,
    frames: timeline.frames.map((_, f) => flatten(id, f)),
  };
  const icon = data.names[`sticker_${name}_icon`];
  clips[`icon_${kind}`] = {
    sourceId: icon,
    fps: data.clips[icon].fps,
    frames: [flatten(icon, 0)],
  };
  settings.expressions[kind] = {
    fps: timeline.fps,
    frames: timeline.frames.length,
  };
}
for (const [name, id] of Object.entries({
  bubble_blue: data.names.sticker_bubble_player_master,
  bubble_red: data.names.sticker_bubble_opponent_master,
  button: data.clips[data.names.HUD_taunt].children.find(
    (c) => c.name === "taunt_button",
  ).id,
  mute: data.clips[data.names.HUD_taunt].children.find(
    (c) => c.name === "mute_btn",
  ).id,
  cell: data.clips[data.names.taunt_selector_new].children.find(
    (c) => c.name === "emoji_btn_01",
  ).id,
})) {
  const clip = data.clips[id];
  clips[name] = {
    sourceId: id,
    fps: clip.fps,
    labels: clip.labels,
    frames: clip.frames.map((_, f) => flatten(id, f)),
  };
  if (name.startsWith("bubble_")) {
    const anchor = data.matrices[clip.frames[60][0].matrix].slice(4);
    settings.bubbles[name.slice(7)] = {
      fps: clip.fps,
      frames: clip.frames.length,
      anchor,
    };
  }
}
const shapes = {},
  files = [],
  [sheetWidth, sheetHeight] = data.textures[0];
for (const id of used) {
  const polygons = [];
  for (const [index, p] of data.shapes[id].entries()) {
    if (p.sheet !== 0) throw new Error(`Unexpected emote atlas ${p.sheet}`);
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
const audio = {},
  audioFiles = [];
const groups = {
  sound_king_happy: "laugh",
  sound_king_crying: "cry",
  sound_king_mad: "angry",
  sound_king_congratulate: "thumbs",
};
let group;
for (const row of csvRows(
  await readFile("reference/client/sounds.csv", "utf8"),
)) {
  if (row.Name) group = groups[row.Name];
  if (!group || !row.FileNames) continue;
  const sourceFile = row.FileNames.replace(/\.wav$/, ".ogg");
  const file = sourceFile.split("/").at(-1);
  const response = await fetch(
    `https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/${sounds.commit}/${sourceFile}`,
  );
  if (!response.ok) throw new Error(`${sourceFile}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(`public/assets/audio/${file}`, bytes);
  (audio[group] ??= {
    files: [],
    volume: Number(row.MinVolume) / 100,
  }).files.push(file.slice(0, -4));
  audioFiles.push({
    file,
    source: sourceFile,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
const json = JSON.stringify({
  clips,
  shapes,
  texts: {},
  translations: {},
  audio: {},
  voices: audio,
});
await writeFile(`${output}/emotes.json`, json);
files.push({
  file: "emotes.json",
  bytes: Buffer.byteLength(json),
  sha256: hash(json),
});
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: source.source,
      commit: source.commit,
      sources: source.sources,
      files,
      audioSource: sounds.source,
      audioCommit: sounds.commit,
      audioFiles,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "src/ui/emote-settings.json",
  JSON.stringify(settings, null, 2) + "\n",
);
console.log(
  `Imported ${Object.keys(clips).length} emote clips, ${used.size} shapes and ${audioFiles.length} voice files.`,
);
