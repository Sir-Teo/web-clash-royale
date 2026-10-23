import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Freeze");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
if (
  !spell ||
  !area ||
  spell.IconFile !== "freeze" ||
  spell.Rarity !== "Epic" ||
  spell.ManaCost !== "4" ||
  spell.AreaEffectObject !== "Freeze" ||
  area.Radius !== "3000" ||
  area.LifeDuration !== "4000" ||
  area.Buff !== "Freeze" ||
  area.BuffTime !== "4000" ||
  area.OnlyEnemies !== "TRUE" ||
  area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" ||
  area.IgnoreBuildings ||
  area.NoEffectToCrownTowers
)
  throw new Error("Recheck archived Freeze card and area rules");
const source = {
  card: spell.Name,
  area: area.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  buffDuration: Number(area.BuffTime) / 1000,
  targets: "enemy",
  hitsGround: true,
  hitsAir: true,
  affectsBuildings: true,
};
const path = "src/game/freeze-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/freeze-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Freeze card and area rules.");
