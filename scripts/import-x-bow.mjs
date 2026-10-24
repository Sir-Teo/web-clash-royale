import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/logic/projectiles.csv",
  "reference/client/effects.csv",
  "reference/sc/building_xbow.bin",
  "reference/sc/building_xbow_tex.png",
  "reference/sc/effects.bin",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Xbow");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === building?.Projectile);
const effects = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const art = parseSC(inputs[6]);
const portraits = parseSC(inputs[7]);
if (card?.IconFile !== "building_xbow" || card.Rarity !== "Epic" ||
    card.ManaCost !== "6" || building?.Hitpoints !== "1000" ||
    building.DeployTime !== "4000" || building.HitSpeed !== "300" ||
    building.SightRange !== "11500" || building.Range !== "11500" ||
    building.LifeTime !== "40000" || building.AttacksGround !== "true" ||
    building.AttacksAir === "true" || building.Projectile !== "xbow_projectile" ||
    building.ProjectileEffect !== "XbowAttack" || building.DeathEffect !== "Cannon_die" ||
    building.SpawnEffect !== "Xbow_deploy" ||
    building.ProjectileStartRadius !== "1000" || building.ProjectileStartZ !== "2400" ||
    building.HasRotationOnTimeline !== "true" || building.TurretMovement !== "10" ||
    projectile?.Speed !== "1400" || projectile.Damage !== "20" ||
    projectile.Homing !== "true" || projectile.HitEffect !== "ArrowHit" ||
    projectile.ExportName !== "projectile_arrow_basic" ||
    projectile.ShadowExportName !== "projectile_arrow_shadow" ||
    !effects.XbowAttack || !effects.Xbow_deploy || !effects.ArrowHit ||
    !model.names.building_xbow_attack1_1 || !model.names.building_xbow_red_attack1 ||
    !art.names.projectile_arrow_basic || !art.names.projectile_arrow_shadow ||
    !portraits.names.building_xbow)
  throw new Error("Recheck archived X-Bow card, projectile, and native art");
const outputPath = "src/game/x-bow-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  sourceDamage: Number(projectile.Damage),
  deployTime: Number(building.DeployTime) / 1000,
  hitSpeed: Number(building.HitSpeed) / 1000,
  range: Number(building.Range) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  hitsAir: building.AttacksAir === "true",
  projectileSpeed: Number(projectile.Speed) / 60,
  projectileStartRadius: Number(building.ProjectileStartRadius) / 1000,
  projectileStartHeight: Number(building.ProjectileStartZ) / 1000,
  projectileArt: projectile.ExportName,
  projectileShadow: projectile.ShadowExportName,
  hitEffect: projectile.HitEffect,
  launchEffect: building.ProjectileEffect,
  spawnEffect: building.SpawnEffect,
  deathEffect: building.DeathEffect,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/x-bow-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived X-Bow rules, art, and projectile evidence.");
