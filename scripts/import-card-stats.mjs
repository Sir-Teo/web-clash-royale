// Project the pinned archive's basic movement and attack values into game units.
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";

const readTable = async (name) => Object.fromEntries(
  csvRows(await readFile(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const [portraits, spells, characters] = await Promise.all([
  readFile("public/assets/ui/cards/cards.json", "utf8")
    .then((text) => JSON.parse(text).portraits),
  readTable("spells_characters"),
  readTable("characters"),
]);

const stats = {};
for (const [id, portrait] of Object.entries(portraits)) {
  if (portrait.table !== "spells_characters") continue;
  // Executioner's axe round trip cannot be reduced to one HitSpeed value.
  // Balloon's movement, reach and main-bomb interval map directly.
  if (id === "executioner") continue;
  const name = spells[portrait.row]?.SummonCharacter;
  const source = characters[name];
  if (!source) throw new Error(`Missing character for ${id}: ${name}`);
  stats[id] = {
    speed: Number(source.Speed) / 60,
    range: Number(source.Range) / 1000,
    interval: Number(source.HitSpeed) / 1000,
  };
  if (Object.values(stats[id]).some((value) => !Number.isFinite(value)))
    throw new Error(`Invalid source stat for ${id}: ${name}`);
}
await writeFile(
  "src/game/archived-card-stats.json",
  `${JSON.stringify(Object.fromEntries(Object.entries(stats).sort()), null, 2)}\n`,
);
console.log(`Imported basic combat stats for ${Object.keys(stats).length} cards.`);
