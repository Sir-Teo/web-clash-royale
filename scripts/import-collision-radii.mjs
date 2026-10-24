// Pin the collision bounds used by historical characters and buildings.
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";

const table = async (name) => Object.fromEntries(
  csvRows(await readFile(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const [portraits, troopSpells, buildingSpells, characters, buildings] =
  await Promise.all([
    readFile("public/assets/ui/cards/cards.json", "utf8")
      .then((text) => JSON.parse(text).portraits),
    table("spells_characters"),
    table("spells_buildings"),
    table("characters"),
    table("buildings"),
  ]);
const radius = (row, name) => {
  const value = Number(row?.CollisionRadius) / 1000;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Missing collision radius for ${name}`);
  return value;
};
const cards = {};
for (const [id, portrait] of Object.entries(portraits)) {
  const troop = portrait.table === "spells_characters";
  if (!troop && portrait.table !== "spells_buildings") continue;
  const spell = (troop ? troopSpells : buildingSpells)[portrait.row];
  const source = (troop ? characters : buildings)[spell?.SummonCharacter];
  cards[id] = radius(source, id);
}
// Split troops are not offered as deck cards and have no portrait rows.
cards.golemite = radius(characters.Golemite, "golemite");
cards["lava-pup"] = radius(characters.LavaPups, "lava-pup");
const towers = {
  king: radius(buildings.KingTower, "King Tower"),
  princess: radius(buildings.PrincessTower, "Princess Tower"),
};
await writeFile(
  "src/game/archived-collision-radii.json",
  `${JSON.stringify({ cards: Object.fromEntries(Object.entries(cards).sort()), towers }, null, 2)}\n`,
);
console.log(`Imported collision radii for ${Object.keys(cards).length} cards and two towers.`);
