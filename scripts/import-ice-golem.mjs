import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/character_buffs.csv",
  "reference/sc/chr_snowman.bin",
  "reference/sc/chr_snowman_tex.png",
  "reference/sc/ui-spells.bin",
  "reference/sc/effects.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "IceGolemite");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const area = csvRows(inputs[2].toString()).find((row) => row.Name === unit?.DeathAreaEffect);
const buff = csvRows(inputs[3].toString()).find((row) => row.Name === area?.Buff);
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
const effects = parseSC(inputs[7]);
if (card?.IconFile !== "ice_golem" || card.Rarity !== "Rare" ||
    card.ManaCost !== "2" || card.SummonNumber !== "1" ||
    unit?.Hitpoints !== "595" || unit.Damage !== "40" ||
    unit.Speed !== "45" || unit.Range !== "750" ||
    unit.HitSpeed !== "2500" || unit.LoadTime !== "1500" ||
    unit.DeployTime !== "1000" || unit.DeathDamage !== "40" ||
    unit.DeathDamageRadius !== "2000" || unit.AttacksAir !== "true" ||
    unit.AttacksGround !== "true" || unit.TargetOnlyBuildings !== "true" ||
    unit.DeathAreaEffect !== "FreezeIceGolemite" ||
    area?.Radius !== "2000" || area.LifeDuration !== "2000" ||
    area.BuffTime !== "2000" || area.Buff !== "IceWizardSlowDown" ||
    area.HitsGround !== "TRUE" || area.HitsAir !== "TRUE" ||
    area.OnlyEnemies !== "TRUE" ||
    area.OneShotEffect !== "IceGolem_slow_loop" ||
    area.ScaledEffect !== "IceGolem_slow_ground" ||
    buff?.SpeedMultiplier !== "-35" || buff.HitSpeedMultiplier !== "-35" ||
    !model.names.snowman_blue_run1_9 || !model.names.snowman_red_attack1_1 ||
    !portraits.names.ice_golem || !effects.names.freeze_effect_ground)
  throw new Error("Recheck archived Ice Golem card, death area and artwork");

const outputPath = "src/game/ice-golem-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  sourceDeployTime: Number(unit.DeployTime) / 1000,
  targetsBuildings: unit.TargetOnlyBuildings === "true",
  deathDamage: Number(unit.DeathDamage),
  deathRadius: Number(unit.DeathDamageRadius) / 1000,
  deathArea: area.Name,
  deathAreaDuration: Number(area.LifeDuration) / 1000,
  slowDuration: Number(area.BuffTime) / 1000,
  slowMultiplier: 1 + Number(buff.SpeedMultiplier) / 100,
  oneShotEffect: area.OneShotEffect,
  groundEffect: area.ScaledEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/ice-golem-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_snowman",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Ice Golem card, death area and artwork bindings.");
