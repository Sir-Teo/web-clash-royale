import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/pending-range-native-trace.json",
  "src/game/combat-data.json",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "src/game/primary-score-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const capture = JSON.parse(bytes[0]);
if (
  capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  capture.cases.length !== 1440 ||
  capture.controls.length !== 72 ||
  !capture.sourceFlags.preserveStarted ||
  capture.extraRange !== 500 ||
  capture.startedThresholdMs !== 50
)
  throw new Error("Recheck native pending range contract");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Pending range input differs: ${input.path}`);
const combat = JSON.parse(bytes[1]);
const rows = Object.fromEntries(
  bytes.slice(2, 4).flatMap((buffer) =>
    csvRows(buffer.toString())
      .filter((row) => row.Name)
      .map((row) => [row.Name, row]),
  ),
);
const projectileSources = [];
for (const [alias, profile] of Object.entries(combat)) {
  const row = rows[profile.source];
  if (
    !row ||
    profile.windup !==
      Math.max(0, (Number(row.HitSpeed) - Number(row.LoadTime)) / 1000) ||
    !!row.Projectile !== !!profile.projectile ||
    (row.Projectile && row.Projectile !== profile.projectile.source)
  )
    throw new Error(`Recheck Data projectile presence: ${alias}`);
  if (row.Projectile) projectileSources.push(profile.source);
}
const scale = JSON.parse(bytes[4]).sourceUnitsPerTile;
if (scale !== 1000) throw new Error("Recheck source coordinate scale");
for (const row of [...capture.cases, ...capture.controls]) {
  const expected =
    row.baseInRange ||
    (row.preserveStarted &&
      row.hasProjectile &&
      row.withinExtraRange &&
      row.intervalMs > 0 &&
      row.elapsedMs % row.intervalMs > capture.startedThresholdMs);
  if (row.computedInRange !== expected)
    throw new Error("Native pending range witness differs");
}
const outputPath = "src/game/pending-range-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      extraRange: capture.extraRange / scale,
      startedThresholdMs: capture.startedThresholdMs,
      projectileSources: [...new Set(projectileSources)].sort(),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/pending-range-manifest.json",
  JSON.stringify(
    {
      source: capture.source,
      nativeSha256: capture.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Started projectile maximum-range allowance on the existing browser attack clock; complete native owner/target-loss scheduling remains separate",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    witnesses: capture.cases.length + capture.controls.length,
    projectileSources: new Set(projectileSources).size,
  }),
);
