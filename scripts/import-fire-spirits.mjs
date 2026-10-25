import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_fire_firespirit.bin",
  "reference/sc/chr_fire_firespirit_tex.png",
  "reference/sc/ui-spells.bin",
  "reference/sc/effects.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "FireSpirits");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === unit?.Projectile);
const model = parseSC(inputs[3]);
const portraits = parseSC(inputs[5]);
const effects = parseSC(inputs[6]);
if (card?.IconFile !== "fire_spirits" || card.Rarity !== "Common" ||
    card.ManaCost !== "2" || card.SummonNumber !== "3" ||
    unit?.Hitpoints !== "43" || unit.Speed !== "120" ||
    unit.Range !== "2000" || unit.HitSpeed !== "300" ||
    unit.LoadTime !== "100" || unit.DeployDelay !== "400" ||
    unit.Kamikaze !== "true" || unit.AttacksAir !== "true" ||
    unit.SpawnRadius !== "650" || unit.Scale !== "120" ||
    projectile?.Damage !== "80" || projectile.Speed !== "400" ||
    projectile.Radius !== "1500" || projectile.Homing !== "true" ||
    projectile.HitEffect !== "firespirit_projectile_hit" ||
    projectile.TrailEffect !== "PrincessArrowProjectileEmitter" ||
    projectile.AoeToAir !== "true" || projectile.AoeToGround !== "true" ||
    !model.names.firespirit_attack1_1 || !model.names.firespirit_run1_9 ||
    !portraits.names.fire_spirits || !effects.names.projectile_firespirit)
  throw new Error("Recheck archived Fire Spirits card, attack and artwork");

const outputPath = "src/game/fire-spirits-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  projectile: projectile.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  deployDelay: Number(unit.DeployDelay) / 1000,
  sourceSpawnRadius: Number(unit.SpawnRadius) / 1000,
  sourceScale: Number(unit.Scale) / 100,
  projectileSpeed: Number(projectile.Speed) / 60,
  sourceProjectileDamage: Number(projectile.Damage),
  splashRadius: Number(projectile.Radius) / 1000,
  projectileExport: projectile.ExportName,
  projectileHitEffect: projectile.HitEffect,
  projectileTrailEffect: projectile.TrailEffect,
  continuousEffect: unit.ContinuousEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/fire-spirits-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_fire_firespirit",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Fire Spirits rules and artwork bindings.");
