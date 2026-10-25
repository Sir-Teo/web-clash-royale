import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/sc/building_inferno_tower.bin",
  "reference/sc/building_inferno_tower_tex.png",
  "reference/sc/effects.bin",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "InfernoTower");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const effects = csvGroups(inputs[2].toString());
const model = parseSC(inputs[3]);
const art = parseSC(inputs[5]);
const portraits = parseSC(inputs[6]);
const beams = ["inferno_beam", "inferno_beam_stage2", "inferno_beam_stage3"];
const muzzles = ["inferno_shoot", "inferno_shoot_st2", "inferno_shoot_st3"];
if (card?.IconFile !== "building_inferno" || card.Rarity !== "Rare" ||
    card.ManaCost !== "5" || building?.Hitpoints !== "800" ||
    building.Damage !== "20" || building.VariableDamage2 !== "75" ||
    building.VariableDamage3 !== "400" ||
    building.VariableDamageTime1 !== "2000" ||
    building.VariableDamageTime2 !== "2000" ||
    building.HitSpeed !== "400" || building.LoadTime !== "1600" ||
    building.DeployTime !== "1000" || building.Range !== "6000" ||
    building.LifeTime !== "40000" ||
    building.AttacksGround !== "true" || building.AttacksAir !== "true" ||
    building.DamageEffect !== "inferno_hit_effect" ||
    building.ContinuousEffect !== "Inferno_continuous" ||
    building.TargettedDamageEffect1 !== "inferno_beam_lvl1" ||
    building.TargettedDamageEffect2 !== "inferno_beam_lvl2" ||
    building.TargettedDamageEffect3 !== "inferno_beam_lvl3" ||
    building.DamageLevelTransitionEffect12 !== "inferno_stage2_root" ||
    building.DamageLevelTransitionEffect23 !== "inferno_stage3_root" ||
    building.FlameEffect1 !== "inferno_muzzle" ||
    building.FlameEffect2 !== "inferno_muzzle_stage2" ||
    building.FlameEffect3 !== "inferno_muzzle_stage3" ||
    building.ProjectileStartZ !== "1000" ||
    !model.names.inferno_blue_idle1_1 || !model.names.inferno_red_idle1_1 ||
    !portraits.names.building_inferno ||
    [...beams, ...muzzles, "inferno_hit_lines"].some((name) => !art.names[name]) ||
    ["inferno_beam_lvl1", "inferno_beam_lvl2", "inferno_beam_lvl3",
      "inferno_stage2_root", "inferno_stage3_root", "inferno_hit_effect",
      "Inferno_continuous"].some((name) => !effects[name]))
  throw new Error("Recheck archived Inferno Tower damage stages and native art");
const outputPath = "src/game/inferno-tower-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  sourceDamage: [Number(building.Damage), Number(building.VariableDamage2),
    Number(building.VariableDamage3)],
  stageDurations: [Number(building.VariableDamageTime1) / 1000,
    Number(building.VariableDamageTime2) / 1000],
  hitSpeed: Number(building.HitSpeed) / 1000,
  loadTime: Number(building.LoadTime) / 1000,
  deployTime: Number(building.DeployTime) / 1000,
  range: Number(building.Range) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  projectileStartHeight: Number(building.ProjectileStartZ) / 1000,
  hitsAir: building.AttacksAir === "true",
  hitEffect: building.DamageEffect,
  continuousEffect: building.ContinuousEffect,
  beamEffects: [building.TargettedDamageEffect1, building.TargettedDamageEffect2,
    building.TargettedDamageEffect3],
  stageEffects: [building.DamageLevelTransitionEffect12,
    building.DamageLevelTransitionEffect23],
  flameEffects: [building.FlameEffect1, building.FlameEffect2,
    building.FlameEffect3],
  beamArt: beams,
  muzzleArt: muzzles,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/inferno-tower-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Inferno Tower stages, model and beam evidence.");
