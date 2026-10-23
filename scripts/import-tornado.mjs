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
const spell = spells.find((row) => row.Name === "Tornado");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  !spell || !area || !buff || spell.IconFile !== "tornado" ||
  spell.Rarity !== "Epic" || spell.ManaCost !== "3" ||
  spell.Radius !== "5500" || spell.SpellAsDeploy !== "true" ||
  spell.OnlyEnemies !== "true" || spell.CanDeployOnEnemySide !== "true" ||
  area.LifeDuration !== "3050" || area.Radius !== "5500" ||
  area.HitSpeed !== "50" || area.BuffTime !== "500" ||
  area.OnlyEnemies !== "TRUE" || area.IgnoreBuildings !== "TRUE" ||
  area.HitsGround !== "TRUE" || area.HitsAir !== "TRUE" ||
  area.ControlsBuff !== "TRUE" || area.AttractPercentage !== "220" ||
  area.ScaledEffect !== "Spell_tornado_deploy" ||
  buff.DamagePerSecond !== "44" || buff.HitFrequency !== "500" ||
  buff.CrownTowerDamagePercent !== "-100" ||
  buff.AttractPercentage !== "220" || buff.ControlledByParent !== "true"
) throw new Error("Recheck archived Tornado spell, area and buff rules");

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
  attractPercentage: Number(area.AttractPercentage) / 100,
  targets: "enemy",
  hitsGround: true,
  hitsAir: true,
  affectsBuildings: false,
  visual: { area: area.ScaledEffect, filter: buff.FilterExportName },
};
const path = "src/game/tornado-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/tornado-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((inputPath, i) => ({ path: inputPath, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Tornado spell, area and buff rules.");
