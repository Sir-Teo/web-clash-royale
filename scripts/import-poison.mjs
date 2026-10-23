import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/character_buffs.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas, buffs] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Poison");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  !spell || !area || !buff ||
  spell.IconFile !== "poison" ||
  spell.Rarity !== "Epic" ||
  spell.ManaCost !== "4" ||
  spell.AreaEffectObject !== "Poison" ||
  area.Radius !== "3500" ||
  area.LifeDuration !== "8000" ||
  area.HitSpeed !== "250" ||
  area.BuffTime !== "1000" ||
  area.OnlyEnemies !== "TRUE" ||
  area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" ||
  area.AffectsHidden ||
  area.IgnoreBuildings ||
  area.NoEffectToCrownTowers ||
  buff.DamagePerSecond !== "57" ||
  buff.HitFrequency !== "1000" ||
  buff.CrownTowerDamagePercent !== "-60"
) throw new Error("Recheck archived Poison card, area and buff rules");

const source = {
  card: spell.Name,
  area: area.Name,
  buff: buff.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  areaHitInterval: Number(area.HitSpeed) / 1000,
  buffDuration: Number(area.BuffTime) / 1000,
  damagePerSecond: Number(buff.DamagePerSecond),
  damageInterval: Number(buff.HitFrequency) / 1000,
  crownTowerDamageFraction: 1 + Number(buff.CrownTowerDamagePercent) / 100,
  targets: "enemy",
  hitsGround: true,
  hitsAir: true,
  affectsBuildings: true,
  affectsHidden: false,
};
const path = "src/game/poison-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/poison-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Poison card, area and buff rules.");
