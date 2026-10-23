import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/sc/effects.bin",
  "reference/logic/area_effect_objects.csv",
];
const [metadata, areaBytes] = await Promise.all(paths.map((p) => readFile(p)));
const area = csvRows(areaBytes.toString()).find((r) => r.Name === "Clone");
if (area?.SpawnDeployBaseAnim !== "filter_hologram")
  throw new Error("Recheck archived Clone hologram binding");
const sc = parseSC(metadata);
function timeline(name, length) {
  const clip = sc.clips[sc.names[name]];
  if (clip?.fps !== 60 || clip.frames.length !== length)
    throw new Error(`Recheck ${name} timeline`);
  return clip.frames.map((frame, i) => {
    if (frame.length !== 1 || frame[0].id !== 592 || frame[0].blend !== 0)
      throw new Error(`Recheck ${name} frame ${i}`);
    const color = sc.colors[frame[0].color];
    if (!color) throw new Error(`Missing ${name} color ${i}`);
    return color;
  });
}
const path = "src/render/clone-filter-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      fps: 60,
      deploy: timeline("filter_hologram", 41),
      character: timeline("filter_hologram_character", 60),
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/clone-filter-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((inputPath, i) => ({
        path: inputPath,
        sha256: sha256([metadata, areaBytes][i]),
      })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported 41 deploy and 60 character hologram color frames.");
