import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const inputs = ["reference/sc/effects.bin", "reference/logic/character_buffs.csv"];
const files = Object.fromEntries(
  await Promise.all(inputs.map(async (path) => [path, await readFile(path)])),
);
const buff = csvRows(files[inputs[1]].toString()).find((row) => row.Name === "Rage");
if (buff?.FilterFile !== "sc/effects.sc" || buff.FilterExportName !== "filter_rage")
  throw new Error("Recheck archived Rage filter binding");
const sc = parseSC(files[inputs[0]]);
const clip = sc.clips[sc.names.filter_rage];
if (clip?.fps !== 30 || clip.frames.length !== 50)
  throw new Error("Recheck filter_rage timeline");
const colors = clip.frames.map((frame, i) => {
  if (frame.length !== 1 || frame[0].id !== 439 || frame[0].blend !== 0 ||
      frame[0].matrix !== 65535)
    throw new Error(`Recheck filter_rage frame ${i}`);
  const color = sc.colors[frame[0].color];
  if (!color) throw new Error(`Missing Rage color ${i}`);
  return color;
});
const path = "src/render/rage-filter-data.json";
const output = Buffer.from(
  JSON.stringify({ source: "filter_rage", fps: clip.fps, colors }, null, 2) + "\n",
);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/rage-filter-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: inputs.map((path) => ({ path, sha256: sha256(files[path]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log(`Imported ${colors.length} Rage filter frames.`);
