import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const paths = [
  "reference/client/tower-layout-native-trace.json",
  "src/game/primary-score-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const native = JSON.parse(bytes[0]);
const units = JSON.parse(bytes[1]).sourceUnitsPerTile;
if (
  native.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  units !== 1000
)
  throw new Error("Recheck native Crown layout binary/coordinate units");
for (const input of native.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Native Crown layout source differs: ${input.path}`);
const map = native.maps.find((row) => row.section === "Map");
if (map?.width !== 36 || map?.height !== 64)
  throw new Error("Recheck native arena dimensions");
const middleX = (map.width * 500) / 2,
  middleY = (map.height * 500) / 2;
const rows = native.cases.filter((row) => row.section === "LayoutPvp");
if (rows.length !== 6) throw new Error("Recheck regular Crown inventory");
const keyed = new Map();
for (const row of rows) {
  if (
    !["PrincessTower", "KingTower"].includes(row.sourceCharacter) ||
    row.sourceUnitsPerCell !== 500 ||
    row.nativePoint.x !== row.gridPoint.x * 500 ||
    row.nativePoint.y !== row.gridPoint.y * 500
  )
    throw new Error("Recheck native Crown position projection");
  const king = row.sourceCharacter === "KingTower";
  // Team labels map source coordinates to the browser's canonical view.
  const team = row.nativePoint.y < middleY ? "red" : "blue";
  const lane = row.nativePoint.x < middleX ? "left" : "right";
  const key = `${team}-${king ? "king" : lane}`;
  if (keyed.has(key)) throw new Error(`Duplicate source Crown role: ${key}`);
  keyed.set(key, {
    team,
    x: row.nativePoint.x / units,
    y: row.nativePoint.y / units,
    king,
    ...(!king ? { lane } : {}),
  });
}
// Preserve browser tower IDs and ordering across the replay-policy change.
const sites = ["red", "blue"].flatMap((team) =>
  ["left", "right", "king"].map((role) => {
    const site = keyed.get(`${team}-${role}`);
    if (!site) throw new Error(`Missing source Crown role: ${team}-${role}`);
    return site;
  }),
);
const outputPath = "src/game/tower-layout-data.json";
const output = Buffer.from(JSON.stringify({ sites }, null, 2) + "\n");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/tower-layout-manifest.json",
  JSON.stringify(
    {
      source: native.source,
      nativeSha256: native.sha256,
      layout: "LayoutPvp",
      sourceUnitsPerTile: units,
      sourceUnitsPerCell: 500,
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
  "Imported six native regular Crown sites in stable browser ID order.",
);
