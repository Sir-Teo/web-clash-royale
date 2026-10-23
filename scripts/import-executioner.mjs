import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_axe_man.bin",
  "reference/sc/effects.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "AxeMan");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "AxeMan");
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === "AxeManProjectile");
const sprite = parseSC(inputs[3]);
const effects = parseSC(inputs[4]);
if (
  card?.Rarity !== "Epic" || card.ManaCost !== "5" ||
  card.IconFile !== "executioner" || card.SummonCharacter !== "AxeMan" ||
  unit?.Hitpoints !== "760" || unit.HitSpeed !== "900" ||
  unit.LoadTime !== "400" || unit.Speed !== "60" ||
  unit.Range !== "4500" || unit.Projectile !== "AxeManProjectile" ||
  unit.AttacksAir !== "true" || unit.AttacksGround !== "true" ||
  unit.BlueExportName !== "axe_man" || unit.RedExportName !== "axe_man_red" ||
  projectile?.Speed !== "550" || projectile.Damage !== "100" ||
  projectile.Radius !== "1000" || projectile.ProjectileRange !== "6500" ||
  projectile.MinDistance !== "4500" || projectile.ConstantHeight !== "3000" ||
  projectile.PingpongVisualTime !== "1500" ||
  projectile.ExportName !== "executioner_projectile" ||
  projectile.ShadowExportName !== "bowler_projectile_shadow" ||
  projectile.HitEffect !== "axe_man_projectile_hit" ||
  projectile.PingpongDeathEffect !== "axe_man_projectile_die" ||
  projectile.TrailEffect !== "AxeProjectileEmitter" ||
  projectile.AoeToAir !== "true" || projectile.AoeToGround !== "true" ||
  !sprite.names.axe_man_idle1_1 || !sprite.names.axe_man_red_attack1_1 ||
  !effects.names.executioner_projectile
) throw new Error("Recheck archived Executioner unit, axe and art");

const outputPath = "src/game/executioner-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  projectile: {
    source: projectile.Name,
    speed: Number(projectile.Speed) / 60,
    damage: Number(projectile.Damage),
    radius: Number(projectile.Radius) / 1000,
    range: Number(projectile.ProjectileRange) / 1000,
    minDistance: Number(projectile.MinDistance) / 1000,
    height: Number(projectile.ConstantHeight) / 1000,
    visualTime: Number(projectile.PingpongVisualTime) / 1000,
    export: projectile.ExportName,
    shadowExport: projectile.ShadowExportName,
    hitEffect: projectile.HitEffect,
    deathEffect: projectile.PingpongDeathEffect,
    trailEffect: projectile.TrailEffect,
    hitsAir: projectile.AoeToAir === "true",
    hitsGround: projectile.AoeToGround === "true",
  },
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/executioner-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_axe_man",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Executioner boomerang axe rules.");
