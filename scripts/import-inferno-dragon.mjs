import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_baby_dragon.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const spells = csvRows(inputs[0].toString());
const characters = csvRows(inputs[1].toString());
const card = spells.find((row) => row.Name === "InfernoDragon");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const sprite = parseSC(inputs[2]);
if (
  !card || !unit || card.Rarity !== "Legendary" || card.ManaCost !== "4" ||
  card.IconFile !== "inferno_dragon" || unit.Hitpoints !== "1000" ||
  unit.Speed !== "60" || unit.Range !== "4000" || unit.HitSpeed !== "400" ||
  unit.Damage !== "30" || unit.VariableDamage2 !== "100" ||
  unit.VariableDamage3 !== "350" || unit.VariableDamageTime1 !== "2000" ||
  unit.VariableDamageTime2 !== "2000" || unit.FlyingHeight !== "4000" ||
  unit.AttacksAir !== "true" || unit.BlueExportName !== "inferno_dragon" ||
  unit.RedExportName !== "inferno_dragon_red" ||
  unit.TargettedDamageEffect1 !== "inferno_dragon_beam_lvl1" ||
  unit.TargettedDamageEffect2 !== "inferno_dragon_beam_lvl2" ||
  unit.TargettedDamageEffect3 !== "inferno_dragon_beam_lvl3" ||
  unit.DamageEffect !== "inferno_hit_effect" ||
  unit.DeployBaseAnimExportName !== "filter_deploy_unit_legendary" ||
  !sprite.names.inferno_dragon_attack1_1 ||
  !sprite.names.inferno_dragon_red_run1_1
) throw new Error("Recheck archived Inferno Dragon card, ramp and sprite");

const outputPath = "src/game/inferno-dragon-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: [Number(unit.Damage), Number(unit.VariableDamage2), Number(unit.VariableDamage3)],
  stageDurations: [Number(unit.VariableDamageTime1) / 1000, Number(unit.VariableDamageTime2) / 1000],
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  sourceFlyingHeight: Number(unit.FlyingHeight),
  hitsAir: unit.AttacksAir === "true",
  beams: [unit.TargettedDamageEffect1, unit.TargettedDamageEffect2, unit.TargettedDamageEffect3],
  flames: [unit.FlameEffect1, unit.FlameEffect2, unit.FlameEffect3],
  hitEffect: unit.DamageEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  deployFilter: unit.DeployBaseAnimExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/inferno-dragon-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Inferno Dragon card, beam ramp and sprite rules.");
