import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const paths = ["reference/sc/effects.bin", "reference/logic/characters.csv"];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const sc = parseSC(inputs[0]);
const bandit = csvRows(inputs[1].toString()).find((row) => row.Name === "Assassin");
const source = "filter_bandit_charge";
const clip = sc.clips[sc.names[source]];
if (bandit?.DashFilter !== source || clip?.fps !== 60 ||
    clip.frames.length !== 60)
  throw new Error("Recheck source Bandit dash filter");
const neutral = [0, 0, 0, 255, 255, 255, 255];
const frames = clip.frames.map((frame, index) => {
  if (frame.length !== 1 || frame[0].id !== 592 || frame[0].blend !== 0)
    throw new Error(`Recheck Bandit dash filter frame ${index}`);
  const matrix = sc.matrices[frame[0].matrix];
  const color = sc.colors[frame[0].color] ?? neutral;
  if (!matrix || matrix[1] !== 0 || matrix[2] !== 0)
    throw new Error(`Unsupported Bandit dash filter affine ${index}`);
  return { matrix, color };
});
const outputPath = "src/render/bandit-filter-data.json";
const output = Buffer.from(JSON.stringify({ source, fps: clip.fps, frames }, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bandit-filter-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported 60 native Bandit dash-filter poses.");
