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
const spell = spells.find((row) => row.Name === "Heal");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  spell?.IconFile !== "heal" || spell.Rarity !== "Rare" ||
  spell.ManaCost !== "3" || spell.Radius !== "3000" ||
  spell.OnlyOwnTroops !== "TRUE" || spell.CastSound !== "SpellCasting" ||
  spell.AreaEffectObject !== "Heal" || area?.Rarity !== "Rare" ||
  area.LifeDuration !== "3050" || area.Radius !== "3000" ||
  area.ScaledEffect !== "Healing" || area.HitSpeed !== "50" ||
  area.Buff !== "Heal" || area.BuffTime !== "500" ||
  area.BuffNumber !== "1" || area.OnlyOwnTroops !== "TRUE" ||
  area.IgnoreBuildings !== "TRUE" || area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" || buff?.Rarity !== "Rare" ||
  buff.HitFrequency !== "500" || buff.HealPerSecond !== "100"
) throw new Error("Recheck archived Heal spell, area and buff rules");

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
  healInterval: Number(buff.HitFrequency) / 1000,
  sourceHealPerSecond: Number(buff.HealPerSecond),
  target: "own-troops",
  hitsGround: true,
  hitsAir: true,
  ignoresBuildings: true,
  visual: area.ScaledEffect,
  castSound: spell.CastSound,
};
const path = "src/game/heal-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile("reference/client/heal-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((inputPath, i) => ({ path: inputPath, sha256: sha256(bytes[i]) })),
  output: { path, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Heal spell, area and buff rules.");
