import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";

const paths = ["reference/sc/effects.bin", "reference/logic/characters.csv"];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const sc = parseSC(inputs[0]);
const bat = csvRows(inputs[1].toString()).find((row) => row.Name === "Bat");
const source = "filter_wiggle";
const clip = sc.clips[sc.names[source]];
if (bat?.LoopingFilter !== source || clip?.fps !== 60 ||
    clip.frames.length !== 58) throw new Error("Recheck source Bat looping filter");
const frames = clip.frames.map((frame, index) => {
  if (frame.length !== 1 || frame[0].id !== 592 || frame[0].blend !== 0)
    throw new Error("Recheck Bat wiggle frame " + index);
  const matrix = sc.matrices[frame[0].matrix];
  const color = sc.colors[frame[0].color];
  if (!matrix || !color || matrix[1] !== 0 || matrix[2] !== 0 ||
      color[3] !== 255)
    throw new Error("Unsupported Bat wiggle transform " + index);
  return { matrix, color };
});
const outputPath = "src/render/bat-wiggle-data.json";
const bytes = Buffer.from(JSON.stringify({ source, fps: clip.fps, frames }, null, 2) + "\n");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
await writeFile(outputPath, bytes);
await writeFile("reference/client/bat-wiggle-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(bytes) },
}, null, 2) + "\n");
console.log("Imported 58 native Bat looping-filter poses.");
