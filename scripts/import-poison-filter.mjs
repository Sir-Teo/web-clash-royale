import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const inputs = [
  "reference/sc/effects.bin",
  "reference/logic/character_buffs.csv",
];
const files = Object.fromEntries(
  await Promise.all(inputs.map(async (path) => [path, await readFile(path)])),
);
const buff = csvRows(files[inputs[1]].toString()).find((row) => row.Name === "Poison");
if (
  buff?.FilterFile !== "sc/effects.sc" ||
  buff.FilterExportName !== "filter_poison" ||
  buff.DamagePerSecond !== "57"
) throw new Error("Recheck archived Poison filter binding");

const sc = parseSC(files[inputs[0]]);
const clip = sc.clips[sc.names.filter_poison];
if (clip?.fps !== 60 || clip.frames.length !== 37)
  throw new Error("Recheck filter_poison timeline");
const frames = clip.frames.map((frame, i) => {
  if (frame.length !== 1 || frame[0].id !== 592 || frame[0].blend !== 0)
    throw new Error(`Recheck filter_poison frame ${i}`);
  const color = sc.colors[frame[0].color];
  const matrix = sc.matrices[frame[0].matrix];
  if (!color || !matrix) throw new Error(`Missing Poison transform ${i}`);
  return { color, matrix };
});
const path = "src/render/poison-filter-data.json";
const output = Buffer.from(
  JSON.stringify({ source: "filter_poison", fps: clip.fps, frames }, null, 2) + "\n",
);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/poison-filter-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: inputs.map((path) => ({ path, sha256: sha256(files[path]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log(`Imported ${frames.length} Poison filter frames.`);
