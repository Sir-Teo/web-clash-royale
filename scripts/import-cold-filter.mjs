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
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const buffs = csvRows(files[inputs[1]].toString());
for (const name of ["Freeze", "ZapFreeze"]) {
  const buff = buffs.find((row) => row.Name === name);
  if (
    buff?.FilterFile !== "sc/effects.sc" ||
    buff.FilterExportName !== "filter_cold" ||
    buff.HitSpeedMultiplier !== "-100" ||
    buff.SpeedMultiplier !== "-100" ||
    buff.SpawnSpeedMultiplier !== "-100"
  )
    throw new Error(`Recheck ${name} cold-filter binding`);
}
const sc = parseSC(files[inputs[0]]);
const clip = sc.clips[sc.names.filter_cold];
if (clip?.fps !== 60 || clip.frames.length !== 29)
  throw new Error("Recheck filter_cold timeline");
const colors = clip.frames.map((frame, i) => {
  if (
    frame.length !== 1 ||
    frame[0].id !== 592 ||
    frame[0].blend !== 0 ||
    frame[0].matrix !== 65535
  )
    throw new Error(`Recheck filter_cold frame ${i}`);
  const color = sc.colors[frame[0].color];
  if (!color) throw new Error(`Missing filter_cold color ${i}`);
  return color;
});
const path = "src/render/cold-filter-data.json";
const output = Buffer.from(
  JSON.stringify({ source: "filter_cold", fps: clip.fps, colors }, null, 2) +
    "\n",
);
await writeFile(path, output);
await writeFile(
  "reference/client/cold-filter-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: inputs.map((path) => ({ path, sha256: sha256(files[path]) })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Imported ${colors.length} cold-filter frames.`);
