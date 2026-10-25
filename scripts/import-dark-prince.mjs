import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_black_knight.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "DarkPrince");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "DarkPrince");
const sprite = parseSC(inputs[2]);
if (
  card?.Rarity !== "Epic" || card.ManaCost !== "4" ||
  card.IconFile !== "dark_prince" || card.SummonCharacter !== "DarkPrince" ||
  unit?.Hitpoints !== "735" || unit.ShieldHitpoints !== "200" ||
  unit.Damage !== "145" || unit.DamageSpecial !== "290" ||
  unit.Speed !== "60" || unit.HitSpeed !== "1500" ||
  unit.Range !== "1050" || unit.AreaDamageRadius !== "1000" ||
  unit.ChargeRange !== "250" || unit.ChargeSpeedMultiplier !== "200" ||
  unit.HealthBar !== "Shield" || unit.ShieldLostEffect !== "GuardShieldDown" ||
  unit.BlueExportName !== "BlackKnight_blue" ||
  unit.RedExportName !== "BlackKnight_red" ||
  unit.BlueShieldExportName !== "BlackKnight_shield_blue" ||
  unit.RedShieldExportName !== "BlackKnight_shield_red" ||
  !sprite.names.BlackKnight_blue_attack1_1 ||
  !sprite.names.BlackKnight_red_charge1_1 ||
  !sprite.names.BlackKnight_shield_blue_idle1_1 ||
  !sprite.names.BlackKnight_shield_red_charge1_1
) throw new Error("Recheck archived Dark Prince rules and sprite");

const outputPath = "src/game/dark-prince-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceShieldHitpoints: Number(unit.ShieldHitpoints),
  sourceDamage: Number(unit.Damage),
  sourceChargeDamage: Number(unit.DamageSpecial),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  splash: Number(unit.AreaDamageRadius) / 1000,
  chargeRange: Number(unit.ChargeRange) / 100,
  chargeSpeedMultiplier: Number(unit.ChargeSpeedMultiplier) / 100,
  shieldBreakEffect: unit.ShieldLostEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  blueShieldExport: unit.BlueShieldExportName,
  redShieldExport: unit.RedShieldExportName,
  hitEffect: unit.DamageEffect,
  chargeHitEffect: unit.DamageEffectSpecial,
  chargeEffect: unit.ChargeEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/dark-prince-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_black_knight",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Dark Prince shield, charge and splash rules.");
