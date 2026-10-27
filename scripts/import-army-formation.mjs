import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/client/formation-native-trace.json",
  "tests/fixtures/native-formation-golden.json",
  "src/game/formation-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters] = bytes
  .slice(0, 2)
  .map((value) => csvRows(value.toString()));
const [trace, golden, formation] = bytes
  .slice(2)
  .map((value) => JSON.parse(value));
const source = spells.find((row) => row.Name === "SkeletonArmy");
const child = characters.find((row) => row.Name === source?.SummonCharacter);
if (
  !source ||
  child?.Name !== "Skeleton" ||
  source.SummonCharacterSecond ||
  source.SummonNumber !== "15" ||
  source.SummonRadius ||
  child.SpawnRadius ||
  child.SpawnAngleShift ||
  child.CollisionRadius !== "500"
)
  throw new Error("Recheck native Skeleton Army formation profile");
if (
  trace.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  golden.sha256 !== trace.sha256 ||
  JSON.stringify(trace.sineTable) !== JSON.stringify(formation.sineTable)
)
  throw new Error("Recheck native Army geometry and sine evidence");
const controls = golden.cases.filter(
  (row) => row.count === 15 && row.radius === 500 && row.angleShift === 0,
);
if (
  controls.length !== 4 ||
  ![false, true].every((flip) =>
    [0, 1].every((lane) =>
      controls.some(
        (row) =>
          row.flipY === flip && row.lane === lane && row.points.length === 15,
      ),
    ),
  )
)
  throw new Error("Missing native fifteen-body formation controls");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const outputPath = "src/game/army-formation-data.json";
const output = Buffer.from(
  JSON.stringify(
    { sourceUnitsPerTile: 1000, count: 15, radius: 500, angleShift: 0 },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/army-formation-manifest.json",
  JSON.stringify(
    {
      source: trace.source,
      nativeSha256: trace.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Skeleton Army integer formation requests before browser clamps and collision separation",
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported native fifteen-body Skeleton Army formation.");
