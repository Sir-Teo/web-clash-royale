import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/logic/characters.csv",
  "reference/logic/spells_characters.csv",
  "reference/logic/globals.csv",
  "src/game/combat-data.json",
  "public/assets/ui/cards/cards.json",
  "reference/client/formation-native-trace.json",
];
const inputs = paths.map((path) => ({ path, bytes: readFileSync(path) }));
const [characters, spells, globals] = inputs
  .slice(0, 3)
  .map(({ bytes }) => csvRows(bytes.toString()));
const combat = JSON.parse(inputs[3].bytes),
  portraits = JSON.parse(inputs[4].bytes).portraits;
const trace = JSON.parse(inputs[5].bytes);
const laneSequenceEnabled =
  globals
    .find((r) => r.Name === "LOGIC_LANE_ID_BASED_DEPLOY_SEQUENCE")
    ?.BooleanValue.toUpperCase() === "TRUE";
if (
  !laneSequenceEnabled ||
  trace.sineTable.length !== 91 ||
  trace.sineTable[90] !== 1024
)
  throw new Error("Recheck native formation inputs");
const cards = {};
for (const [id, profile] of Object.entries(combat)) {
  const spell = spells.find((r) => r.Name === portraits[id]?.row);
  const count = Number(spell?.SummonNumber || 1);
  if (!spell || spell.SummonCharacterSecond || count < 2 || count > 6) continue;
  const unit = characters.find((r) => r.Name === spell.SummonCharacter);
  if (!unit || profile.source !== unit.Name)
    throw new Error(`Recheck formation alias ${id}`);
  const override = Number(spell.SummonRadius),
    spawnRadius = Number(unit.SpawnRadius);
  const radius =
    override > 0
      ? override
      : spawnRadius > 0
        ? spawnRadius
        : Number(unit.CollisionRadius);
  const angleShift = Number(unit.SpawnAngleShift || 0);
  if (
    !(radius > 0) ||
    !Number.isInteger(radius) ||
    !Number.isInteger(angleShift)
  )
    throw new Error(`Recheck native formation radius ${id}`);
  cards[id] = { source: unit.Name, count, radius, angleShift };
}
if (
  cards.archers?.radius !== 500 ||
  cards["three-musketeers"]?.radius !== 800 ||
  cards["fire-spirits"]?.radius !== 650 ||
  cards.bats?.angleShift !== 45 ||
  cards["goblin-gang"] ||
  cards["skeleton-army"]
)
  throw new Error("Recheck supported native formations");
const path = "src/game/formation-data.json";
const output = Buffer.from(
  JSON.stringify(
    { laneSequenceEnabled, sineTable: trace.sineTable, cards },
    null,
    2,
  ) + "\n",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
writeFileSync(path, output);
writeFileSync(
  "reference/client/formation-manifest.json",
  JSON.stringify(
    {
      inputs: inputs.map(({ path, bytes }) => ({ path, sha256: hash(bytes) })),
      output: { path, sha256: hash(output) },
      limits: [
        "Only homogeneous card groups with two through six bodies are adopted.",
        "Native lane lookup, grid snapping and creation-time collision resolution are not reproduced; the browser retains its current edge clamps and uses its two-lane split for sequence reflection.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Retained ${Object.keys(cards).length} native card formations and 91 integer sine values.`,
);
