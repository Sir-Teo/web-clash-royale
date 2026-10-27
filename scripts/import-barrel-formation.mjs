import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const paths = [
  "reference/client/projectile-formation-native-trace.json",
  "src/game/formation-data.json",
  "src/game/distant-target-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [capture, formation, coordinates] = bytes.map((value) =>
  JSON.parse(value),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (
  capture.sha256 !==
  "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Recheck native Barrel formation binary");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Native Barrel formation input differs: ${input.path}`);
const profile = capture.sourceProfile;
if (
  profile.count !== 3 ||
  profile.radius !== 500 ||
  profile.angleShift !== 0 ||
  !profile.spawnConstPriority ||
  !profile.laneSequenceEnabled ||
  !formation.laneSequenceEnabled ||
  coordinates.sourceUnitsPerTile !== 1000 ||
  capture.cases.length !== 220 ||
  capture.controls.length !== 40
)
  throw new Error("Recheck native Barrel formation profile");
for (const row of capture.cases) {
  if (
    row.children.length !== profile.count ||
    row.count !== profile.count ||
    row.collisionRadius !== profile.radius ||
    row.angleShift !== profile.angleShift
  )
    throw new Error("Native Barrel formation profile differs across cases");
  const offsets = [
    [0, -577],
    [-499, 288],
    [499, 288],
  ];
  for (const [index, child] of row.children.entries()) {
    const [x, y] = offsets[index];
    if (
      child.index !== index ||
      child.hint !== row.center.x ||
      child.fieldAC !== (index * 20) ** 2 ||
      child.x !== row.center.x + (row.lane === 1 ? x : -x) ||
      child.y !== row.center.y + (row.ownerIndex === 0 ? -y : y)
    )
      throw new Error("Native Barrel formation coordinate/ordinal differs");
  }
}
const outputPath = "src/game/barrel-formation-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      sourceUnitsPerTile: coordinates.sourceUnitsPerTile,
      count: profile.count,
      radius: profile.radius,
      angleShift: profile.angleShift,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/barrel-formation-manifest.json",
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
        "Regular-arena Barrel child formation requests before browser edge clamps and collision adjustment",
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported native Barrel child formation parameters.");
