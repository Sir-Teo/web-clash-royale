import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = ["reference/logic/spells_other.csv", "reference/logic/projectiles.csv"];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, projectiles] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Log");
const launch = projectiles.find((row) => row.Name === spell?.Projectile);
const rolling = projectiles.find((row) => row.Name === launch?.SpawnProjectile);
if (
  !spell || !launch || !rolling || spell.IconFile !== "the_log" ||
  spell.Rarity !== "Legendary" || spell.ManaCost !== "2" ||
  spell.SpellAsDeploy !== "true" || spell.OnlyEnemies !== "true" ||
  spell.Effect !== "log_deploy" ||
  launch.Name !== "LogProjectile" || launch.Speed !== "360" ||
  launch.MinDistance !== "3000" || launch.Radius !== "1950" ||
  launch.RadiusY !== "600" || launch.HitEffect !== "log_hit" ||
  launch.ExportName !== "log_projectile" ||
  launch.ShadowExportName !== "log_projectile_shadow" ||
  launch.TrailEffect !== "log_emitter" ||
  rolling.Name !== "LogProjectileRolling" || rolling.Speed !== "200" ||
  rolling.Damage !== "240" || rolling.ProjectileRange !== "11100" ||
  rolling.ProjectileRadius !== "1950" || rolling.ProjectileRadiusY !== "600" ||
  rolling.CrownTowerDamagePercent !== "-60" ||
  rolling.Pushback !== "1000" || rolling.PushbackAll !== "true" ||
  rolling.AoeToGround !== "true" || rolling.OnlyEnemies !== "true" ||
  rolling.ExportName !== "log_roll_projectile" ||
  rolling.RedExportName !== "log_roll_projectile_red" ||
  rolling.HitEffect !== "log_hit" || rolling.DeathEffect !== "log_die" ||
  rolling.TrailEffect !== "log_emitter"
) throw new Error("Recheck archived Log spell and two projectile stages");

const source = {
  card: spell.Name,
  launchProjectile: launch.Name,
  rollingProjectile: rolling.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  launchSpeed: Number(launch.Speed) / 60,
  launchMinimumDistance: Number(launch.MinDistance) / 1000,
  rollingSpeed: Number(rolling.Speed) / 60,
  rollingRange: Number(rolling.ProjectileRange) / 1000,
  collisionRadius: Number(rolling.ProjectileRadius) / 1000,
  collisionHalfWidth: Number(rolling.ProjectileRadiusY) / 1000,
  sourceDamage: Number(rolling.Damage),
  crownTowerDamageFraction: 1 + Number(rolling.CrownTowerDamagePercent) / 100,
  knockback: Number(rolling.Pushback) / 1000,
  hitsGround: true,
  hitsAir: false,
  targets: "enemy",
  visual: {
    launch: launch.ExportName,
    roll: rolling.ExportName,
    rollRed: rolling.RedExportName,
    shadow: rolling.ShadowExportName,
    hit: rolling.HitEffect,
    death: rolling.DeathEffect,
    trail: rolling.TrailEffect,
  },
};
const path = "src/game/log-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/log-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((inputPath, i) => ({ path: inputPath, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Log spell and rolling projectile rules.");
