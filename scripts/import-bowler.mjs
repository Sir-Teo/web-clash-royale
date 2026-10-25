import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_bowler.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Bowler");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "Bowler");
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === "BowlerProjectile");
const sprite = parseSC(inputs[3]);
if (
  card?.Rarity !== "Epic" || card.ManaCost !== "5" ||
  card.SummonCharacter !== "Bowler" || card.IconFile !== "bowler" ||
  unit?.Hitpoints !== "1200" || unit.Speed !== "45" ||
  unit.Range !== "5000" || unit.HitSpeed !== "2500" ||
  unit.Projectile !== "BowlerProjectile" ||
  unit.BlueExportName !== "bowler_blue" || unit.RedExportName !== "bowler_red" ||
  projectile?.Damage !== "180" || projectile.Speed !== "170" ||
  projectile.ProjectileRange !== "6000" || projectile.Radius !== "1800" ||
  projectile.Pushback !== "1000" || projectile.AoeToGround !== "true" ||
  projectile.OnlyEnemies !== "true" ||
  projectile.ExportName !== "bowler_projectile" ||
  projectile.ShadowExportName !== "bowler_projectile_shadow" ||
  !sprite.names.bowler_blue_attack1_1 || !sprite.names.bowler_red_run1_1
) throw new Error("Recheck archived Bowler rules and sprite");

const outputPath = "src/game/bowler-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range),
  sourceHitSpeed: Number(unit.HitSpeed),
  projectile: {
    source: unit.Projectile,
    damage: Number(projectile.Damage),
    speed: Number(projectile.Speed) / 60,
    range: Number(projectile.ProjectileRange) / 1000,
    radius: Number(projectile.Radius) / 1000,
    collisionRadius: Number(projectile.ProjectileRadius) / 1000,
    knockback: Number(projectile.Pushback) / 1000,
    groundOnly: projectile.AoeToGround === "true",
    onlyEnemies: projectile.OnlyEnemies === "true",
    export: projectile.ExportName,
    shadowExport: projectile.ShadowExportName,
    trailEffect: projectile.TrailEffect,
    deathEffect: projectile.DeathEffect,
  },
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  attackStartEffect: unit.AttackStartEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bowler-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_bowler",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Bowler boulder and combat rules.");
