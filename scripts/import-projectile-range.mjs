import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/projectile-range-native-trace.json",
  "reference/client/projectile-flight-native-trace.json",
  "reference/logic/projectiles.csv",
  "reference/logic/characters.csv",
  "src/game/combat-data.json",
];
const bytes = await Promise.all(paths.map((p) => readFile(p)));
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const [early, flight] = bytes.slice(0, 2).map((b) => JSON.parse(b));
for (const capture of [early, flight]) {
  if (
    capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck range binary");
  for (const input of capture.inputs)
    if (sha256(await readFile(input.path)) !== input.sha256)
      throw new Error(`Range source differs: ${input.path}`);
}
if (
  early.profiles.length !== 38 ||
  early.cases.length !== 1824 ||
  early.controls.length !== 154 ||
  flight.profiles.length !== 3 ||
  flight.cases.length !== 144 ||
  flight.controls.length !== 31
)
  throw new Error("Recheck range witness inventory");
const projectiles = Object.fromEntries(
  csvRows(bytes[2].toString())
    .filter((r) => r.Name)
    .map((r) => [r.Name, r]),
);
const characters = Object.fromEntries(
  csvRows(bytes[3].toString())
    .filter((r) => r.Name)
    .map((r) => [r.Name, r]),
);
const combat = JSON.parse(bytes[4]);
const ranges = {};
for (const [alias, profile] of Object.entries(combat)) {
  const row = characters[profile.source];
  const source = row && projectiles[row.Projectile];
  if (
    !source ||
    !Number(source.ProjectileRadius) ||
    !Number(source.ProjectileRange) ||
    source.Homing.toLowerCase() === "true"
  )
    continue;
  if (
    !["bowler", "executioner"].includes(alias) ||
    source.RandomAngle ||
    source.SpawnProjectile ||
    source.MaxDistance
  )
    throw new Error("Recheck supported source range alias");
  const fields = {
    projectileRadius: Number(source.ProjectileRadius),
    projectileRange: Number(source.ProjectileRange),
    homing: false,
    minimum: Number(source.MinDistance),
    maximum: Number(source.MaxDistance),
  };
  const earlyRows = early.cases.filter((r) => r.sourceName === source.Name);
  const lateRows = flight.cases.filter((r) => r.sourceName === source.Name);
  if (
    earlyRows.length !== 48 ||
    lateRows.length !== 48 ||
    earlyRows.some(
      (r) =>
        !r.rangeApplied ||
        !r.targetCleared ||
        Object.entries(fields).some(([k, v]) => r.fields[k] !== v),
    )
  )
    throw new Error("Source range fields differ");
  for (const sample of lateRows) {
    const witness = earlyRows.find(
      (r) =>
        r.actorPresent === sample.actorPresent &&
        r.liveTarget === sample.liveTargetArgument &&
        JSON.stringify(r.actorPoint) === JSON.stringify(sample.actorPoint) &&
        JSON.stringify(r.providedGoal) === JSON.stringify(sample.providedGoal),
    );
    if (
      !witness ||
      JSON.stringify(witness.initializedGoal) !==
        JSON.stringify(sample.initialized.goal) ||
      sample.initialized.target !== null ||
      !sample.initialized.unrelatedHeapUnchanged ||
      sample.frames.some((r) => !r.unrelatedHeapUnchanged)
    )
      throw new Error("Late native destination differs");
  }
  ranges[profile.source] = { projectile: source.Name, ...fields };
}
if (
  Object.keys(ranges).length !== 2 ||
  ranges.Bowler.projectileRange !== 6000 ||
  ranges.AxeMan.projectileRange !== 6500
)
  throw new Error("Recheck range projection");
const outputPath = "src/game/projectile-range-data.json";
const output = Buffer.from(
  JSON.stringify({ sourceUnitsPerTile: 1000, ranges }, null, 2) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/projectile-range-manifest.json",
  JSON.stringify(
    {
      source: early.source,
      nativeSha256: early.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Source Bowler/Executioner caster-center range normalization and later muzzle-relative bounds after rounding browser points to source units; no arena endpoint clamp. Existing browser speed, trajectories, collision and timing retained; rolling Log caller chain remains separate.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    profiles: Object.keys(ranges).length,
    earlyWitnesses: 96,
    lateWitnesses: 96,
  }),
);
