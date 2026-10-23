import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvGroups, csvRows } from "./lib/csv.mjs";

const inputs = [
  "reference/sc/effects.bin",
  "reference/client/effects.csv",
  "reference/logic/characters.csv",
];
const files = Object.fromEntries(
  await Promise.all(inputs.map(async (path) => [path, await readFile(path)])),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sc = parseSC(files[inputs[0]]);
const effects = csvGroups(files[inputs[1]].toString());
const characters = csvRows(files[inputs[2]].toString());
const prince = characters.find((row) => row.Name === "Prince");
const filter = effects.prince_charge.find((row) => row.Type === "Filter");
if (
  prince?.ChargeEffect !== "prince_charge" ||
  filter?.FileName !== "sc/effects.sc" ||
  filter.ExportName !== "filter_protection" ||
  filter.Layer !== "Base"
)
  throw new Error("Recheck Prince charge filter binding");
const clip = sc.clips[sc.names[filter.ExportName]];
if (clip?.fps !== 60 || clip.frames.length !== 54)
  throw new Error("Recheck filter_protection timeline");
const neutral = [0, 0, 0, 255, 255, 255, 255];
const colors = clip.frames.map((frame, i) => {
  if (
    frame.length !== 1 ||
    frame[0].id !== 592 ||
    frame[0].blend !== 0 ||
    frame[0].matrix !== 65535
  )
    throw new Error(`Recheck filter_protection frame ${i}`);
  return sc.colors[frame[0].color] ?? neutral;
});
const data = {
  source: "filter_protection",
  fps: clip.fps,
  colors,
};
const path = "src/render/charge-filter-data.json";
const output = Buffer.from(JSON.stringify(data, null, 2) + "\n");
await writeFile(path, output);
await writeFile(
  "reference/client/charge-filter-manifest.json",
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
console.log(`Imported ${colors.length} Prince charge filter frames.`);
