import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/projectile-launch-native-trace.json",
  "reference/client/crown-owner-native-trace.json",
  "src/game/combat-data.json",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/client/projectile-height-native-trace.json",
  "reference/logic/projectiles.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [capture, owners, combat] = bytes
  .slice(0, 3)
  .map((value) => JSON.parse(value));
const heights = JSON.parse(bytes[5]);
for (const source of [capture, owners, heights]) {
  if (
    source.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck muzzle binary");
  for (const input of source.inputs)
    if (sha256(await readFile(input.path)) !== input.sha256)
      throw new Error(`Muzzle source differs: ${input.path}`);
}
if (
  capture.profiles.length !== 27 ||
  capture.cases.length !== 1620 ||
  capture.controls.length !== 204
)
  throw new Error("Recheck muzzle witness inventory");
for (const [y, owner] of [
  [3000, 0],
  [29000, 1],
]) {
  if (
    !owners.cases.some(
      (row) =>
        row.section === "LayoutPvp" &&
        row.sourceCharacter === "KingTower" &&
        row.nativePoint.y === y &&
        row.ownerIndex === owner,
    )
  )
    throw new Error("Recheck physical owner mapping");
}
const rows = Object.fromEntries(
  bytes.slice(3, 5).flatMap((value) =>
    csvRows(value.toString())
      .filter((row) => row.Name)
      .map((row) => [row.Name, row]),
  ),
);
const fields = (row) => ({
  radius: Number(row.ProjectileStartRadius),
  z: Number(row.ProjectileStartZ),
  y: Number(row.ProjectileYOffset),
});
for (const row of [...capture.cases, ...capture.controls]) {
  const dx = row.goal.x - row.actorPoint.x,
    dy = row.goal.y - row.actorPoint.y;
  const d = Math.floor(Math.sqrt(dx * dx + dy * dy));
  const f = fields(row.fields);
  const start = [
    row.actorPoint.x + (d ? Math.trunc((dx * f.radius) / d) : dx),
    row.actorPoint.y +
      (d ? Math.trunc((dy * f.radius) / d) : dy) +
      (row.owner === 0 ? f.y : -f.y),
    row.actorPoint.z + f.z,
  ];
  const a = row.arguments;
  const expected = [a[0], a[1], ...start, a[2], a[3], a[4], ...a.slice(5)];
  if (
    d !== row.integerDistance ||
    JSON.stringify(expected) !== JSON.stringify(row.request) ||
    !row.heapUnchanged
  )
    throw new Error("Native muzzle request differs");
}
const projectiles = Object.fromEntries(
  csvRows(bytes[6].toString())
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
if (
  heights.profiles.length !== 38 ||
  heights.cases.length !== 228 ||
  heights.controls.length !== 48
)
  throw new Error("Recheck native height inventory");
for (const row of [...heights.cases, ...heights.controls]) {
  const expectedZ = row.constantHeight || row.point.z;
  if (
    row.stored.z !== expectedZ ||
    row.stored.launchHeight !== expectedZ ||
    row.stored.targetHeight !==
      (row.constantHeight || row.initialTargetHeight) ||
    row.stored.x !== row.point.x ||
    row.stored.y !== row.point.y ||
    !row.historyUnchanged ||
    !row.unrelatedHeapUnchanged
  )
    throw new Error("Native ConstantHeight store differs");
}
const muzzles = {};
for (const profile of Object.values(combat)) {
  const row = rows[profile.source];
  if (!row || !!row.Projectile !== !!profile.projectile)
    throw new Error("Muzzle combat source differs");
  if (!row.Projectile) continue;
  const witnesses = capture.cases.filter(
    (sample) => sample.sourceName === profile.source,
  );
  if (
    witnesses.length !== 60 ||
    witnesses.some(
      (sample) =>
        JSON.stringify(fields(sample.fields)) !== JSON.stringify(fields(row)),
    )
  )
    throw new Error(`Muzzle fields differ: ${profile.source}`);
  const constantHeight = Number(projectiles[row.Projectile].ConstantHeight);
  const heightWitnesses = heights.cases.filter(
    (sample) => sample.sourceName === row.Projectile,
  );
  if (
    heightWitnesses.length !== 6 ||
    heightWitnesses.some((sample) => sample.constantHeight !== constantHeight)
  )
    throw new Error("Source constant-height witnesses differ");
  muzzles[profile.source] = {
    ...fields(row),
    ...(constantHeight ? { constantHeight } : {}),
  };
}
if (
  Object.keys(muzzles).length !== 26 ||
  muzzles.KingTower.y !== 400 ||
  muzzles.Cannon.radius !== 1000 ||
  muzzles.AxeMan.constantHeight !== 3000
)
  throw new Error("Recheck muzzle projection");
const outputPath = "src/game/projectile-muzzle-data.json";
const output = Buffer.from(
  JSON.stringify(
    { sourceUnitsPerTile: 1000, ownerForTeam: { red: 0, blue: 1 }, muzzles },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/projectile-muzzle-manifest.json",
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
        "Source muzzle radius/Z/Y, integer XY normalization and later ConstantHeight override on the existing browser scheduler and trajectories; browser XY rounds to source units, ordinary Z is relative to rendered body height and ConstantHeight replaces it absolutely",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ profiles: Object.keys(muzzles).length }));
