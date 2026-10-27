import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const path = "reference/client/attack-range-native-trace.json";
const bytes = await readFile(path);
const trace = JSON.parse(bytes);
const sightPath = "reference/client/sight-range-native-trace.json";
const sightBytes = await readFile(sightPath);
const sight = JSON.parse(sightBytes);
const minimumPath = "reference/client/attack-minimum-native-trace.json";
const minimumBytes = await readFile(minimumPath);
const minimum = JSON.parse(minimumBytes);
const candidatePath = "reference/client/candidate-minimum-native-trace.json";
const candidateBytes = await readFile(candidatePath);
const candidate = JSON.parse(candidateBytes);
const mortarPath = "src/game/mortar-data.json";
const mortarBytes = await readFile(mortarPath);
const mortar = JSON.parse(mortarBytes);
const radiiPath = "src/game/archived-collision-radii.json";
const radiiBytes = await readFile(radiiPath);
const radii = JSON.parse(radiiBytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
for (const input of [
  ...trace.inputs,
  ...sight.inputs,
  ...minimum.inputs,
  ...candidate.inputs,
])
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error("Source tables differ from native attack-range capture");
if (
  trace.addCharacterRangeToRadius !== true ||
  trace.profiles.length !== 13 ||
  trace.profiles.some((profile) =>
    profile.samples.some((sample) => sample.inRange !== sample.offset <= 0),
  )
)
  throw new Error("Recheck native maximum attack-range evidence");
if (
  sight.sha256 !== trace.sha256 ||
  sight.addCharacterRangeToRadius !== trace.addCharacterRangeToRadius ||
  sight.profiles.length !== 13 ||
  sight.profiles.some(
    (profile) =>
      profile.getters.length !== 2 ||
      profile.getters.some(
        (getter) =>
          getter.sightRange !==
          profile.SightRange +
            (getter.addOwnRadius ? profile.CollisionRadius : 0),
      ),
  )
)
  throw new Error("Recheck native sight own-radius agreement");
const inner = minimum.profiles.find((profile) => profile.name === "Mortar");
const scanned = candidate.profiles.find((profile) => profile.name === "Mortar");
const largestRadius =
  Math.max(...Object.values(radii.cards), ...Object.values(radii.towers)) *
  1000;
if (
  [minimum, candidate].some(
    (capture) =>
      capture.sha256 !== trace.sha256 ||
      capture.addCharacterRangeToRadius !== true,
  ) ||
  !inner ||
  !scanned ||
  inner.MinimumRange !== mortar.minimumRange * 1000 ||
  inner.CollisionRadius !== radii.cards.mortar * 1000 ||
  scanned.MinimumRange !== inner.MinimumRange ||
  scanned.CollisionRadius !== inner.CollisionRadius ||
  largestRadius > inner.MinimumRange + inner.CollisionRadius
)
  throw new Error("Recheck native minimum-range profile and roster bounds");
const predicateSamples = new Map(
  inner.samples
    .filter((sample) => sample.addOwnRadius)
    .map((sample) => [
      `${sample.targetRadius}:${sample.x}:${sample.y}`,
      sample.inRange,
    ]),
);
let shared = 0;
for (const sample of scanned.samples.filter(
  (point) => point.addOwnRadius && point.targetRadius <= largestRadius,
)) {
  const key = `${sample.targetRadius}:${sample.x}:0`;
  if (!predicateSamples.has(key)) continue;
  shared++;
  if (predicateSamples.get(key) !== sample.passesCandidateGates)
    throw new Error(
      "Native attack and candidate minimum gates disagree for roster-sized targets",
    );
}
if (shared < 18)
  throw new Error("Missing shared native minimum-range boundaries");
const outputPath = "src/game/attack-range-data.json";
const output = Buffer.from(
  JSON.stringify(
    { ownRadiusFactor: Number(trace.addCharacterRangeToRadius) },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/attack-range-manifest.json",
  JSON.stringify(
    {
      source: trace.source,
      nativeSha256: trace.sha256,
      inputs: [
        ...trace.inputs,
        { path, sha256: sha256(bytes) },
        { path: sightPath, sha256: sha256(sightBytes) },
        { path: minimumPath, sha256: sha256(minimumBytes) },
        { path: candidatePath, sha256: sha256(candidateBytes) },
        { path: mortarPath, sha256: sha256(mortarBytes) },
        { path: radiiPath, sha256: sha256(radiiBytes) },
      ],
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported captured native range radius factor.");
