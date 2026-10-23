import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const inputs = [
  "reference/sc/effects.bin",
  "reference/logic/characters.csv",
  "src/game/combat-data.json",
];
const files = Object.fromEntries(
  await Promise.all(inputs.map(async (path) => [path, await readFile(path)])),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sc = parseSC(files[inputs[0]]);
const characters = csvRows(files[inputs[1]].toString());
const combat = JSON.parse(files[inputs[2]]);
const name = "filter_deploy_unit_default";
const cards = Object.entries(combat)
  .filter(([id, profile]) => {
    const row = characters.find((c) => c.Name === profile.source);
    return (
      row?.DeployBaseAnimExportName === name &&
      id !== "king-tower" &&
      id !== "princess-tower"
    );
  })
  .map(([id]) => id);
if (cards.length !== 25)
  throw new Error(`Recheck source deploy filter bindings: ${cards.length}`);
const clip = sc.clips[sc.names[name]];
if (clip?.fps !== 60 || clip.frames.length !== 28)
  throw new Error("Recheck source deploy filter timeline");
const identity = [1, 0, 0, 1, 0, 0];
const neutral = [0, 0, 0, 255, 255, 255, 255];
const frames = clip.frames.map((frame, i) => {
  if (frame.length !== 1 || frame[0].id !== 592 || frame[0].blend !== 0)
    throw new Error(`Recheck deploy filter frame ${i}`);
  const matrix = sc.matrices[frame[0].matrix] ?? identity;
  if (matrix[1] !== 0 || matrix[2] !== 0 || matrix[4] !== 0)
    throw new Error(`Unsupported deploy filter affine at frame ${i}`);
  return {
    matrix,
    color: sc.colors[frame[0].color] ?? neutral,
  };
});
const data = { source: name, fps: clip.fps, cards, frames };
const path = "src/render/deploy-filter-data.json";
const output = Buffer.from(JSON.stringify(data, null, 2) + "\n");
await writeFile(path, output);
await writeFile(
  "reference/client/deploy-filter-manifest.json",
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
console.log(
  `Imported ${frames.length} deploy filter frames for ${cards.length} troop families.`,
);
