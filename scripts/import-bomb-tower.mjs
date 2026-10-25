import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/logic/projectiles.csv",
  "reference/client/effects.csv",
  "reference/sc/building_bomb_tower.bin",
  "reference/sc/building_bomb_tower_tex.png",
  "reference/sc/effects.bin",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "BombTower");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === building?.Projectile);
const effects = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const projectileArt = parseSC(inputs[6]);
const portraits = parseSC(inputs[7]);
if (card?.IconFile !== "bomb_tower" || card.Rarity !== "Rare" ||
    card.ManaCost !== "5" || building?.Hitpoints !== "950" ||
    building.HitSpeed !== "1600" || building.LoadTime !== "1100" ||
    building.DeployTime !== "1000" || building.Range !== "6000" ||
    building.LifeTime !== "40000" || building.AttacksGround !== "true" ||
    building.AttachedCharacter !== "Bomber" ||
    building.AttachedCharacterHeight !== "3200" ||
    building.DeathDamage || building.DeathDamageRadius ||
    building.DeathEffect !== "BombTower_die" ||
    building.ProjectileEffect !== "BombTower_attack" ||
    building.AttackStartEffect !== "BombTower_attack_start" ||
    projectile?.ExportName !== "projectile_bomb" ||
    projectile.Damage !== "100" || projectile.Radius !== "1500" ||
    projectile.Speed !== "500" || projectile.Gravity !== "200" ||
    projectile.AoeToGround !== "true" ||
    projectile.HitEffect !== "BombTower_projectile_hit" ||
    projectile.TrailEffect !== "BomberBomb_fire_emitter" ||
    !effects.BombTower_die || !effects.BombTower_attack ||
    !effects.BombTower_projectile_hit ||
    !model.names.building_bomb_tower_blue ||
    !model.names.building_bomb_tower_red ||
    !model.names.building_bomb_tower_top_blue ||
    !model.names.building_bomb_tower_top_red ||
    !projectileArt.names.projectile_bomb ||
    !portraits.names.bomb_tower)
  throw new Error("Recheck archived Bomb Tower rules and original artwork");
const outputPath = "src/game/bomb-tower-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  sourceDamage: Number(projectile.Damage),
  deployTime: Number(building.DeployTime) / 1000,
  hitSpeed: Number(building.HitSpeed) / 1000,
  loadTime: Number(building.LoadTime) / 1000,
  range: Number(building.Range) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  splash: Number(projectile.Radius) / 1000,
  projectileSpeed: Number(projectile.Speed) / 60,
  gravity: Number(projectile.Gravity),
  attachedCharacter: building.AttachedCharacter,
  attachedCharacterHeight: Number(building.AttachedCharacterHeight) / 1000,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
  blueTopExport: building.BlueTopExportName,
  redTopExport: building.RedTopExportName,
  deathEffect: building.DeathEffect,
  hitEffect: projectile.HitEffect,
  projectileTrail: projectile.TrailEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bomb-tower-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Bomb Tower and attached Bomber source rules.");
