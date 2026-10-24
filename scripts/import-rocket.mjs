import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/projectiles.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, projectiles] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Rocket");
const projectile = projectiles.find((row) => row.Name === spell?.Projectile);
const fireballSpell = spells.find((row) => row.Name === "Fireball");
const fireball = projectiles.find(
  (row) => row.Name === fireballSpell?.Projectile,
);
if (
  !spell ||
  !projectile ||
  spell.IconFile !== "rocket" ||
  spell.Rarity !== "Rare" ||
  spell.ManaCost !== "6" ||
  spell.Projectile !== "RocketSpell" ||
  spell.OnlyEnemies !== "true" ||
  spell.CastSound !== "sound_rocket_spawn" ||
  projectile.FileName !== "sc/effects.sc" ||
  projectile.ExportName !== "projectile_rocket" ||
  projectile.ShadowExportName !== "projectile_shadow_rocket" ||
  projectile.HitEffect !== "Rocket_explosion" ||
  projectile.TrailEffect !== "Rocket_Emitter" ||
  projectile.Damage !== "700" ||
  projectile.Speed !== "350" ||
  projectile.Radius !== "2000" ||
  projectile.CrownTowerDamagePercent !== "-60" ||
  projectile.Pushback !== "1800" ||
  projectile.Gravity !== "50" ||
  projectile.AoeToAir !== "true" ||
  projectile.AoeToGround !== "true" ||
  projectile.OnlyEnemies !== "true" ||
  projectile.use360Frames !== "true" ||
  fireball?.Damage !== "325"
)
  throw new Error("Recheck archived Rocket card and projectile rules");

// Match the existing Fireball balance anchor while preserving the archived
// Rocket values independently of browser runtime movement interpretation.
// Damage uses Fireball's 689/325 scale; Crown Tower damage retains Rocket's
// archived -60% field (0.4), independently of existing direct-spell defaults.
const damageScale = {
  normalizedFireballDamage: 689,
  sourceFireballDamage: 325,
};
const source = {
  card: spell.Name,
  projectile: projectile.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  sourceDamage: Number(projectile.Damage),
  damage: Math.round((Number(projectile.Damage) * 689) / 325),
  damageScale,
  sourceSpeed: Number(projectile.Speed),
  speed: Number(projectile.Speed) / 60,
  radius: Number(projectile.Radius) / 1000,
  sourceCrownTowerDamagePercent: Number(projectile.CrownTowerDamagePercent),
  crownTowerDamageFraction:
    1 + Number(projectile.CrownTowerDamagePercent) / 100,
  sourcePushback: Number(projectile.Pushback),
  knockback: Number(projectile.Pushback) / 1000,
  sourceGravity: Number(projectile.Gravity),
  gravity: Number(projectile.Gravity),
  targets: "enemy",
  hitsGround: true,
  hitsAir: true,
  use360Frames: true,
  exportName: projectile.ExportName,
  shadowExportName: projectile.ShadowExportName,
  impactEffect: projectile.HitEffect,
  trailEffect: projectile.TrailEffect,
  sourceRows: { spell, projectile },
};
if (source.damage !== 1484) throw new Error("Recheck normalized Rocket damage");
const path = "src/game/rocket-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/rocket-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Rocket card and projectile rules.");
