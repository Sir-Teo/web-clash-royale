// Correct the largest curated health/damage gaps using the pinned 1.8.x
// character and projectile tables and the roster's established scales.
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
const fields = {
  "mini-pekka": ["hp"],
  bomber: ["hp", "damage"],
  "baby-dragon": ["hp"],
  prince: ["hp"],
  pekka: ["hp"],
  goblins: ["damage"],
  "goblin-gang": ["damage"],
  "spear-goblins": ["damage"],
  witch: ["damage"],
};
const scales = {
  Common: { hp: 1666 / 660, damage: 202 / 75 },
  Rare: { hp: 720 / 340, damage: 218 / 100 },
  Epic: { hp: 1.1 ** 5, damage: 1.1 ** 5 },
  Legendary: { hp: 1.1 ** 2, damage: 1.1 ** 2 },
};
const projected = {};
for (const [id, wanted] of Object.entries(fields)) {
  const portrait = portraits[id];
  if (portrait?.table !== "spells_characters")
    throw new Error(`Missing character portrait for ${id}`);
  const spell = spells[portrait.row];
  const source = characters[spell?.SummonCharacter];
  const scale = scales[spell?.Rarity];
  if (!source || !scale) throw new Error(`Missing archived row for ${id}`);
  const result = {};
  for (const field of wanted) {
    const raw = field === "hp"
      ? Number(source.Hitpoints)
      : Number(source.Damage) || Number(projectiles[source.Projectile]?.Damage);
    if (!Number.isFinite(raw) || raw <= 0)
      throw new Error(`Missing ${field} source value for ${id}`);
    result[field] = Math.round(raw * scale[field]);
  }
  projected[id] = result;
}
await writeFile(
  "src/game/archived-card-vitals.json",
  `${JSON.stringify(Object.fromEntries(Object.entries(projected).sort()), null, 2)}\n`,
);
console.log(`Imported source-normalized vitals for ${Object.keys(projected).length} cards.`);
