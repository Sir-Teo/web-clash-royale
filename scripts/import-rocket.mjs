import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = ["reference/logic/spells_other.csv", "reference/logic/projectiles.csv"];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, projectiles] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Rocket");
const projectile = projectiles.find((row) => row.Name === spell?.Projectile);
if (
  !spell || !projectile || spell.IconFile !== "rocket" ||
  spell.Rarity !== "Rare" || spell.ManaCost !== "6" ||
  spell.OnlyEnemies !== "true" ||
  projectile.Name !== "RocketSpell" ||
  projectile.Speed !== "350" || projectile.Damage !== "700" ||
  projectile.Radius !== "2000" || projectile.Pushback !== "1800" ||
  projectile.CrownTowerDamagePercent !== "-60" ||
  projectile.AoeToAir !== "true" || projectile.AoeToGround !== "true" ||
  projectile.OnlyEnemies !== "true" ||
  projectile.Gravity !== "50" ||
  projectile.FileName !== "sc/effects.sc" ||
  projectile.ExportName !== "projectile_rocket" ||
  projectile.ShadowExportName !== "projectile_shadow_rocket" ||
  projectile.HitEffect !== "Rocket_explosion" ||
  projectile.TrailEffect !== "Rocket_Emitter" ||
  projectile.use360Frames !== "true"
) throw new Error("Recheck archived Rocket card and projectile rules");

const source = {
  card: spell.Name,
  projectile: projectile.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(projectile.Radius) / 1000,
  sourceDamage: Number(projectile.Damage),
  speed: Number(projectile.Speed) / 60,
  knockback: Number(projectile.Pushback) / 1000,
  crownTowerDamageFraction: 1 + Number(projectile.CrownTowerDamagePercent) / 100,
  hitsGround: true,
  hitsAir: true,
  targets: "enemy",
  visual: {
    projectile: projectile.ExportName,
    shadow: projectile.ShadowExportName,
    hit: projectile.HitEffect,
    trail: projectile.TrailEffect,
    directionalFrames: true,
  },
};
const path = "src/game/rocket-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/rocket-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Rocket card and projectile rules.");
