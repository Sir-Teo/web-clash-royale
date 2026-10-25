import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_battle_ram.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "BattleRam");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "BattleRam");
const sprite = parseSC(inputs[2]);
if (
  card?.Rarity !== "Rare" || card.ManaCost !== "4" ||
  card.IconFile !== "battle_ram" || card.SummonCharacter !== "BattleRam" ||
  unit?.Hitpoints !== "430" || unit.Damage !== "140" ||
  unit.DamageSpecial !== "280" || unit.Speed !== "60" ||
  unit.HitSpeed !== "400" || unit.Range !== "500" ||
  unit.ChargeRange !== "300" || unit.ChargeSpeedMultiplier !== "200" ||
  unit.TargetOnlyBuildings !== "true" || unit.Kamikaze !== "true" ||
  unit.DeathSpawnCharacter !== "Barbarian" || unit.DeathSpawnCount !== "2" ||
  unit.DeathSpawnRadius !== "600" || unit.DeathSpawnDeployTime !== "800" ||
  unit.BlueExportName !== "battle_ram" || unit.RedExportName !== "battle_ram_red" ||
  !sprite.names.battle_ram_charge1_1 || !sprite.names.battle_ram_red_charge1_1 ||
  !sprite.names.battle_ram_idle1_1 || !sprite.names.battle_ram_red_idle1_1
) throw new Error("Recheck archived Battle Ram rules and sprite");

const outputPath = "src/game/battle-ram-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceChargeDamage: Number(unit.DamageSpecial),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  chargeRange: Number(unit.ChargeRange) / 100,
  chargeSpeedMultiplier: Number(unit.ChargeSpeedMultiplier) / 100,
  targetsBuildings: unit.TargetOnlyBuildings === "true",
  deathSpawnCharacter: unit.DeathSpawnCharacter,
  deathSpawnCount: Number(unit.DeathSpawnCount),
  deathSpawnRadius: Number(unit.DeathSpawnRadius) / 1000,
  deathSpawnDeployTime: Number(unit.DeathSpawnDeployTime) / 1000,
  kamikaze: unit.Kamikaze === "true",
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  deathEffect: unit.DeathEffect,
  chargeEffect: unit.ChargeEffect,
  hitEffect: unit.TargetedHitEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/battle-ram-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_battle_ram",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Battle Ram building charge and Barbarian release rules.");
