import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const paths = [
  "reference/client/distant-target-native-trace.json",
  "reference/client/lane-assignment-native-trace.json",
  "reference/client/spawn-lane-native-trace.json",
  "reference/locations/tilemap.csv",
  "src/game/primary-score-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [distant, lanes, spawned] = bytes
  .slice(0, 3)
  .map((value) => JSON.parse(value));
for (const capture of [distant, lanes, spawned]) {
  if (
    capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck native distant-target binary");
  for (const input of capture.inputs)
    if (sha256(await readFile(input.path)) !== input.sha256)
      throw new Error(`Native distant-target source differs: ${input.path}`);
}
if (
  spawned.directCallerCount !== 13 ||
  spawned.cases.length !== 142 ||
  !Object.values(distant.sourceFlags).every((value) => value === true)
)
  throw new Error("Recheck direct spawn callers and archived target flags");
const map = lanes.maps.find((row) => row.section === "Map");
if (map?.width !== 36 || map?.height !== 64)
  throw new Error("Recheck arena dimensions");
const units = JSON.parse(bytes[4]).sourceUnitsPerTile;
if (units !== 1000) throw new Error("Recheck browser/source coordinate scale");

// The fixed-point fraction and bias constants come from retained native
// instructions; the complete numeric/score matrices independently verify them.
const projected = {
  sourceUnitsPerTile: units,
  sourceUnitsPerCell: 500,
  gridWidth: map.width,
  gridHeight: map.height,
  hintXBias: 5,
  distanceNumerator: 53,
  distanceDenominator: 128,
  interiorLaneBias: 125,
  boundaryLaneBias: 1000,
  boundaryCells: 3,
  expectedPrincesses: 2,
  useLaneId: true,
  alwaysPrincess: true,
};
for (const sample of distant.numericControls) {
  if (
    sample.coordinate !== undefined &&
    sample.gridY !==
      Math.trunc(sample.coordinate / projected.sourceUnitsPerCell)
  )
    throw new Error("Native grid scale differs");
  if (sample.approximateDistance !== undefined) {
    const x = Math.abs(sample.dx),
      y = Math.abs(sample.dy);
    if (
      sample.approximateDistance !==
      Math.max(x, y) +
        Math.floor(
          (Math.min(x, y) * projected.distanceNumerator) /
            projected.distanceDenominator,
        )
    )
      throw new Error("Native distant-distance fraction differs");
  }
}
for (const sample of [...distant.cases, ...distant.controls]) {
  const gridY = Math.trunc(sample.ownerPoint.y / projected.sourceUnitsPerCell);
  for (const scored of sample.scores) {
    const target = sample.candidates.find((row) => row.id === scored.target);
    const bias =
      sample.useLaneId && target.lane === sample.ownerLane
        ? gridY >= projected.boundaryCells &&
          gridY < sample.worldScalar8C - projected.boundaryCells
          ? projected.interiorLaneBias
          : projected.boundaryLaneBias
        : 0;
    const d = scored.approximateDistance;
    if (scored.adjustedScore !== d * d - 2 * d * bias - bias * bias)
      throw new Error("Native lane-score projection differs");
  }
}

// Exact mirrored positive labels confined to opposite half-planes imply that
// the nearest lane is determined by the quantized X half, for every Y.
// This CSV has repeated column names; preserve the full grid with its raw rows.
const matrix = bytes[3]
  .toString()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.split(",").map((value) => value.replace(/^"|"$/g, "")));
for (const loadedMap of lanes.maps) {
  const start = matrix.findIndex((row) => row[0] === loadedMap.section);
  if (start < 0) throw new Error("Missing archived map section");
  const grid = matrix
    .slice(start + 3, start + 3 + projected.gridHeight)
    .map((row) => row.slice(1).map((value) => Number(value || 0) & 3));
  if (grid.some((row) => row.length !== projected.gridWidth))
    throw new Error("Archived map width differs");
  let positive = 0;
  for (let y = 0; y < projected.gridHeight; y++)
    for (let x = 0; x < projected.gridWidth; x++) {
      const label = grid[y][x];
      if (!label) continue;
      positive++;
      if (
        grid[y][projected.gridWidth - 1 - x] !== 3 - label ||
        (label === 1
          ? x >= projected.gridWidth / 2
          : label !== 2 || x < projected.gridWidth / 2)
      )
        throw new Error("Source nearest-lane half-plane reduction differs");
    }
  if (positive !== loadedMap.laneCells["1"] + loadedMap.laneCells["2"])
    throw new Error("Source lane-cell inventory differs");
}
const outputPath = "src/game/distant-target-data.json";
const output = Buffer.from(JSON.stringify(projected, null, 2) + "\n");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/distant-target-manifest.json",
  JSON.stringify(
    {
      source: distant.source,
      nativeSha256: distant.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Archived two-account regular-arena troop destinations and spawn lane policy",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Imported native regular-arena lane and distant-target arithmetic.",
);
