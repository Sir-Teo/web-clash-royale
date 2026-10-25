// Project archived melee and projectile hit radii where curated cards differ.
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";

const table = async (name) => Object.fromEntries(
  csvRows(await readFile(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const [portraits, spells, characters, projectiles] = await Promise.all([
  readFile("public/assets/ui/cards/cards.json", "utf8")
    .then((text) => JSON.parse(text).portraits),
  table("spells_characters"),
  table("characters"),
  table("projectiles"),
]);
const ids = ["baby-dragon", "bomber", "valkyrie", "witch", "wizard"];
const radii = {};
for (const id of ids) {
  const portrait = portraits[id];
  if (portrait?.table !== "spells_characters")
    throw new Error(`Missing character portrait for ${id}`);
  const character = characters[spells[portrait.row]?.SummonCharacter];
  if (!character) throw new Error(`Missing character for ${id}`);
  const melee = Number(character.AreaDamageRadius);
  const projectile = projectiles[character.Projectile];
  const ranged = Number(projectile?.Radius);
  const source = melee || ranged;
  if (!Number.isFinite(source) || source <= 0 ||
      (!melee && projectile?.AoeToGround !== "true"))
    throw new Error(`Missing splash radius for ${id}`);
  radii[id] = source / 1000;
}
await writeFile(
  "src/game/archived-card-splash.json",
  `${JSON.stringify(Object.fromEntries(Object.entries(radii).sort()), null, 2)}\n`,
);
console.log(`Imported splash radii for ${ids.length} cards.`);
