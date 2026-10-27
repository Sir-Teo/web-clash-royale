import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/client/primary-acquisition-native-trace.json",
  "reference/client/spawn-priority-native-trace.json",
  "reference/logic/projectiles.csv",
  "src/game/goblin-barrel-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const primary = JSON.parse(bytes[0]),
  spawn = JSON.parse(bytes[1]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
for (const capture of [primary, spawn]) {
  if (
    capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck native primary-score binary");
  for (const input of capture.inputs)
    if (sha256(await readFile(input.path)) !== input.sha256)
      throw new Error(`Native primary-score input differs: ${input.path}`);
}
const row = csvRows(bytes[2].toString()).find(
  (row) => row.Name === "GoblinBarrelSpell",
);
const barrel = JSON.parse(bytes[3]);
if (
  row.SpawnConstPriority !== "TRUE" ||
  row.SpawnCharacter !== "Goblin" ||
  Number(row.SpawnCharacterCount) !== barrel.spawnCount ||
  barrel.spawnCount !== 3
)
  throw new Error("Recheck archived Barrel priority profile");
const witnesses = spawn.cases.filter(
  (sample) => sample.sourceControl === "archived",
);
const barrelScoreBias = witnesses[0].spawnSteps.map((step) => step.fieldAC);
if (
  witnesses.length !== 416 ||
  barrelScoreBias.length !== barrel.spawnCount ||
  barrelScoreBias[0] !== 0
)
  throw new Error("Recheck native Barrel priority witnesses");
for (const sample of witnesses)
  if (
    JSON.stringify(sample.spawnSteps.map((step) => step.fieldAC)) !==
    JSON.stringify(barrelScoreBias)
  )
    throw new Error("Native Barrel priorities disagree");
if (
  !primary.cases.some(
    (sample) => sample.case === "center-over-edge" && sample.nominated === "a",
  ) ||
  !primary.cases.some(
    (sample) =>
      sample.case === "positive-field-adjustment" && sample.nominated === "b",
  )
)
  throw new Error("Recheck native squared-center ranking witnesses");
const outputPath = "src/game/primary-score-data.json";
const output = Buffer.from(
  JSON.stringify({ sourceUnitsPerTile: 1000, barrelScoreBias }, null, 2) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/primary-score-manifest.json",
  JSON.stringify(
    {
      source: primary.source,
      nativeSha256: primary.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Imported native squared-center ranking and Barrel child score adjustments.",
);
