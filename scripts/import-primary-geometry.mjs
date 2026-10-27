import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/logic/globals.csv",
  "src/game/combat-data.json",
  "reference/client/primary-geometry-native-trace.json",
  "reference/client/sight-target-types-native-trace.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const geometry = JSON.parse(bytes[4]),
  types = JSON.parse(bytes[5]);
for (const capture of [geometry, types]) {
  if (
    capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck native primary geometry binary");
  for (const input of capture.inputs)
    if (sha256(await readFile(input.path)) !== input.sha256)
      throw new Error(`Native primary geometry input differs: ${input.path}`);
}
const globals = Object.fromEntries(
  csvRows(bytes[2].toString()).map((row) => [row.Name, row]),
);
if (
  globals.ADD_CHARACTER_RANGE_TO_RADIUS.BooleanValue !== "TRUE" ||
  types.extraSightToCrownTowers !==
    Number(globals.EXTRA_SIGHT_RANGE_TO_CROWN_TOWERS.NumberValue) ||
  types.extraSightToBuilding !==
    Number(globals.EXTRA_SIGHT_RANGE_TO_BUILDING.NumberValue)
)
  throw new Error("Recheck archived primary geometry globals");
const rows = Object.fromEntries(
  [...csvRows(bytes[0].toString()), ...csvRows(bytes[1].toString())].map(
    (row) => [row.Name, row],
  ),
);
const profiles = {};
for (const binding of Object.values(JSON.parse(bytes[3]))) {
  const row = rows[binding.source];
  if (!row)
    throw new Error(`Missing primary geometry source ${binding.source}`);
  const rear = Number(row.Speed) === 0 ? 0 : Number(row.SightClip) || 1000;
  const side = Number(row.SightClipSide);
  profiles[binding.source] = { rear: rear / 1000, side: side / 1000 };
}
if (geometry.cases.length !== 8112 || geometry.controls.length !== 3692)
  throw new Error("Recheck native primary geometry coverage");
for (const sample of [...geometry.cases, ...geometry.controls]) {
  const profile = profiles[sample.owner];
  if (
    !profile ||
    profile.rear * 1000 !== sample.resolvedSightClip ||
    profile.side * 1000 !== sample.sourceSightClipSide
  )
    throw new Error("Source clip projection differs from native measurements");
}
const outputPath = "src/game/primary-geometry-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      buildingSightExtra: types.extraSightToBuilding / 1000,
      crownSightExtra: types.extraSightToCrownTowers / 1000,
      profiles,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/primary-geometry-manifest.json",
  JSON.stringify(
    {
      source: geometry.source,
      nativeSha256: geometry.sha256,
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
  `Imported native primary geometry for ${Object.keys(profiles).length} source profiles.`,
);
