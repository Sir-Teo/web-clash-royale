import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/projectiles.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas, projectiles] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Lightning");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const projectile = projectiles.find((row) => row.Name === area?.Projectile);
if (
  !spell || !area || !projectile ||
  spell.IconFile !== "lightning" || spell.Rarity !== "Epic" ||
  spell.ManaCost !== "6" || spell.OnlyEnemies !== "true" ||
  spell.Radius !== "3500" ||
  area.LifeDuration !== "1500" || area.Radius !== "3500" ||
  area.HitSpeed !== "460" || area.HitBiggestTargets !== "TRUE" ||
  area.OnlyEnemies !== "TRUE" || area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" || area.ProjectileStartHeight !== "10" ||
  area.Projectile !== "LighningSpell" ||
  projectile.Speed !== "500" || projectile.Damage !== "650" ||
  projectile.CrownTowerDamagePercent !== "-60" ||
  projectile.HitEffect !== "Spell_lightning_effect" ||
  projectile.TargetBuff !== "ZapFreeze" || projectile.BuffTime !== "500"
) throw new Error("Recheck archived Lightning spell, area and projectile rules");

const source = {
  card: spell.Name,
  area: area.Name,
  projectile: projectile.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  strikeInterval: Number(area.HitSpeed) / 1000,
  targetPriority: "highestHp",
  sourceDamage: Number(projectile.Damage),
  projectileSpeed: Number(projectile.Speed) / 60,
  projectileStartHeight: Number(area.ProjectileStartHeight),
  crownTowerDamageFraction: 1 + Number(projectile.CrownTowerDamagePercent) / 100,
  stunDuration: Number(projectile.BuffTime) / 1000,
  hitsGround: true,
  hitsAir: true,
  targets: "enemy",
  visual: { hit: projectile.HitEffect },
};
const path = "src/game/lightning-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/lightning-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((inputPath, i) => ({ path: inputPath, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Lightning spell, area and projectile rules.");
