import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvGroups, csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/sc/effects.bin",
  "reference/client/effects.csv",
  "reference/client/texts.csv",
  "reference/logic/characters.csv",
  "public/assets/ui/supercell-magic.ttf",
];
const files = Object.fromEntries(
  await Promise.all(paths.map(async (path) => [path, await readFile(path)])),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = parseSC(files["reference/sc/effects.bin"]);
const effects = csvGroups(files["reference/client/effects.csv"].toString());
const characters = csvRows(files["reference/logic/characters.csv"].toString());
const translations = csvRows(files["reference/client/texts.csv"].toString());
const prince = characters.find((row) => row.Name === "Prince");
if (prince?.ChargeEffect !== "prince_charge")
  throw new Error("Recheck Prince ChargeEffect binding");
const marker = effects.prince_charge.find(
  (row) => row.Type === "SWF" && row.ExportName === "effect_charge",
);
if (
  marker?.TextParentInstanceName !== "charge" ||
  marker.TextInstanceName !== "txt"
)
  throw new Error("Recheck Prince charge text instance binding");
const text = translations.find((row) => row[" "] === "TID_CHARGE")?.EN;
if (text !== "Charge!") throw new Error(`Recheck TID_CHARGE: ${text}`);
const root = source.clips[source.names.effect_charge];
if (root?.fps !== 30 || root.frames.length !== 43)
  throw new Error("Recheck effect_charge source timeline");
const identity = [1, 0, 0, 1, 0, 0],
  neutral = [0, 0, 0, 255, 255, 255, 255];
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
const round = (n) => Math.round(n * 100000) / 100000;
function flatten(id, frame, matrix = identity, color = neutral, depth = 0) {
  if (depth > 5) throw new Error("Recursive charge marker display list");
  if (source.texts[id])
    return [
      {
        text: id,
        binding: "TID_CHARGE",
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  const clip = source.clips[id];
  if (!clip?.frames.length) throw new Error(`Missing charge child ${id}`);
  return clip.frames[frame % clip.frames.length].flatMap((child) =>
    flatten(
      child.id,
      frame,
      multiply(matrix, source.matrices[child.matrix] ?? identity),
      tint(color, source.colors[child.color] ?? neutral),
      depth + 1,
    ),
  );
}
const frames = root.frames.map((_, frame) =>
  flatten(source.names.effect_charge, frame),
);
if (frames.some((frame) => frame.length !== 1 || frame[0].text !== 24))
  throw new Error("Recheck charge marker's dynamic text child");
const data = {
  clips: { effect_charge: { fps: root.fps, frames } },
  texts: { 24: source.texts[24] },
  translations: { TID_CHARGE: text },
  shapes: {},
  audio: {},
};
const outputPath = "src/render/charge-marker-data.json",
  bytes = Buffer.from(JSON.stringify(data, null, 2) + "\n");
await writeFile(outputPath, bytes);
await writeFile(
  "reference/client/charge-marker-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path) => ({ path, sha256: hash(files[path]) })),
      output: { path: outputPath, sha256: hash(bytes) },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Imported ${frames.length} Prince charge text frames.`);
