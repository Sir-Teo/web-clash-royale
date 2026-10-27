import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/placement-bounds-native-trace.json",
  "reference/logic/spells_characters.csv",
  "reference/logic/spells_buildings.csv",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "public/assets/ui/cards/cards.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const capture = JSON.parse(bytes[0]);
if (
  capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  capture.cases.length !== 60 ||
  capture.controls.length !== 40 ||
  capture.clamps.length !== 120
)
  throw new Error("Recheck native placement bounds inventory");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Placement input differs: ${input.path}`);
const tables = bytes.slice(1, 5).map((buffer) =>
  Object.fromEntries(
    csvRows(buffer.toString())
      .filter((row) => row.Name)
      .map((row) => [row.Name, row]),
  ),
);
const [troopSpells, buildingSpells, characters, buildings] = tables;
const portraits = JSON.parse(bytes[5]).portraits;
const cards = {},
  bodies = {};
function footprint(row) {
  return {
    tileSize:
      Number(row.TileSizeOverride) ||
      Math.trunc((Number(row.CollisionRadius) + 499) / 500) + 1,
    noDeployWidth: Number(row.NoDeploySizeW),
    noDeployHeight: Number(row.NoDeploySizeH),
  };
}
for (const [alias, portrait] of Object.entries(portraits)) {
  const spell = troopSpells[portrait.row];
  if (spell?.SummonCharacter) {
    const row = characters[spell.SummonCharacter];
    if (!row || !Number(row.Speed))
      throw new Error(`Recheck ordinary source troop: ${alias}`);
    cards[alias] = {
      flying: Number(row.FlyingHeight) > 0,
      canDeployOnEnemySide: spell.CanDeployOnEnemySide.toLowerCase() === "true",
    };
    if (
      cards[alias].canDeployOnEnemySide !==
      capture.sourceSpellEnemySideFlags[spell.Name]
    )
      throw new Error("Source spell flag differs");
  }
  const building = buildingSpells[portrait.row];
  if (building?.SummonCharacter) {
    const row = buildings[building.SummonCharacter];
    if (!row || Number(row.Speed))
      throw new Error("Recheck source stationary building");
    bodies[alias] = footprint(row);
  }
}
bodies.king = footprint(buildings.KingTower);
bodies.princess = footprint(buildings.PrincessTower);
if (
  Object.keys(cards).length !== 48 ||
  !bodies.cannon ||
  bodies.king.noDeployWidth !== 18 ||
  bodies.princess.noDeployHeight !== 21
)
  throw new Error("Recheck imported placement profiles");
for (const row of capture.cases.filter((row) => row.scenario === "allCrowns"))
  if (
    JSON.stringify(row.bounds) !==
    JSON.stringify(row.ownerIndex === 0 ? [0, 14500] : [17499, 31000])
  )
    throw new Error("Native initial bounds differ");
const outputPath = "src/game/placement-bounds-data.json";
const output = Buffer.from(
  JSON.stringify(
    { sourceUnitsPerTile: 1000, width: 18, height: 32, cards, bodies },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/placement-bounds-manifest.json",
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
        "Ordinary troop ground-child Y bounds; browser placement permissions and factory collision remain separate",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    cards: Object.keys(cards).length,
    bodies: Object.keys(bodies).length,
  }),
);
