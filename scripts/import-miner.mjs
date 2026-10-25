import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_miner.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Miner");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "Miner");
const sprite = parseSC(inputs[2]);
if (
  card?.Rarity !== "Legendary" || card.ManaCost !== "3" ||
  card.CanDeployOnEnemySide !== "true" || card.SummonCharacter !== "Miner" ||
  card.IconFile !== "miner" || unit?.Hitpoints !== "1000" ||
  unit.Damage !== "160" || unit.Speed !== "90" ||
  unit.Range !== "1300" || unit.HitSpeed !== "1200" ||
  unit.CrownTowerDamagePercent !== "-60" ||
  unit.SpawnPathfindSpeed !== "650" ||
  unit.SpawnPathfindEffect !== "miner_travel_effect" ||
  unit.DamageEffect !== "miner_hit" ||
  unit.BlueExportName !== "miner_blue" ||
  unit.RedExportName !== "miner_red" ||
  unit.DeployBaseAnimExportName !== "filter_deploy_unit_miner" ||
  !sprite.names.miner_blue_attack1_1 || !sprite.names.miner_red_run1_1
) throw new Error("Recheck archived Miner rules and sprite");

const outputPath = "src/game/miner-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  enemySide: card.CanDeployOnEnemySide === "true",
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  crownTowerDamageFraction: 1 + Number(unit.CrownTowerDamagePercent) / 100,
  travelSpeed: Number(unit.SpawnPathfindSpeed) / 60,
  travelEffect: unit.SpawnPathfindEffect,
  hitEffect: unit.DamageEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  deployFilter: unit.DeployBaseAnimExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/miner-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_miner",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Miner underground travel and combat rules.");
