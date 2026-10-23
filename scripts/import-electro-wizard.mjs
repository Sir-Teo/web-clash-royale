import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/character_buffs.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/sc/chr_electro_wizard.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const find = (index, name) => csvRows(inputs[index].toString()).find((row) => row.Name === name);
const card = find(0, "ElectroWizard");
const unit = find(1, "ElectroWizard");
const buff = find(2, "ZapFreeze");
const zap = find(3, "Zap");
const sprite = parseSC(inputs[4]);
if (
  card?.Rarity !== "Legendary" || card.ManaCost !== "4" ||
  card.SummonCharacter !== "ElectroWizard" || card.IconFile !== "electro_wizard" ||
  unit?.Hitpoints !== "600" || unit.Damage !== "100" ||
  unit.Speed !== "90" || unit.Range !== "5000" ||
  unit.HitSpeed !== "1700" || unit.MultipleTargets !== "2" ||
  unit.AllTargetsHit !== "true" || unit.AttacksAir !== "true" ||
  unit.BuffOnDamage !== "ZapFreeze" || unit.BuffOnDamageTime !== "500" ||
  unit.SpawnAreaObject !== "Zap" || unit.SpawnAreaObjectLevelIndex !== "8" ||
  unit.TargetedHitEffect !== "electro_wizard_beam" ||
  unit.DamageEffect !== "electro_wizard_hit" ||
  unit.BlueExportName !== "electro_wizard" ||
  unit.RedExportName !== "electro_wizard_red" ||
  unit.DeployBaseAnimExportName !== "filter_deploy_unit_legendary" ||
  buff?.HitSpeedMultiplier !== "-100" || buff.SpeedMultiplier !== "-100" ||
  zap?.Damage !== "75" || zap.Radius !== "2500" ||
  zap.Buff !== "ZapFreeze" || zap.BuffTime !== "500" ||
  !sprite.names.electro_wizard_attack1_1 ||
  !sprite.names.electro_wizard_red_run1_1
) throw new Error("Recheck archived Electro Wizard rules and sprite");

const outputPath = "src/game/electro-wizard-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  targets: Number(unit.MultipleTargets),
  hitsAir: unit.AttacksAir === "true",
  stun: Number(unit.BuffOnDamageTime) / 1000,
  deployZap: {
    sourceDamage: Number(zap.Damage),
    radius: Number(zap.Radius) / 1000,
    levelIndex: Number(unit.SpawnAreaObjectLevelIndex),
    stun: Number(zap.BuffTime) / 1000,
  },
  beam: unit.TargetedHitEffect,
  hitEffect: unit.DamageEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  deployFilter: unit.DeployBaseAnimExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/electro-wizard-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_electro_wizard",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Electro Wizard dual attack, deployment Zap and sprite rules.");
