import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/logic/character_buffs.csv",
  "reference/sc/chr_ice_wizard.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters, projectiles, buffs] = bytes
  .slice(0, 4)
  .map((input) => csvRows(input.toString()));
const card = spells.find((row) => row.Name === "IceWizard");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const projectile = projectiles.find((row) => row.Name === unit?.Projectile);
const buff = buffs.find((row) => row.Name === projectile?.TargetBuff);
const sprite = parseSC(bytes[4]);
if (
  !card ||
  !unit ||
  !projectile ||
  !buff ||
  card.IconFile !== "ice_wizard" ||
  card.Rarity !== "Legendary" ||
  card.ManaCost !== "3" ||
  unit.Hitpoints !== "665" ||
  unit.Speed !== "60" ||
  unit.Range !== "5500" ||
  unit.HitSpeed !== "1500" ||
  unit.AttacksGround !== "true" ||
  unit.AttacksAir !== "true" ||
  unit.BlueExportName !== "ice_wizard" ||
  unit.RedExportName !== "ice_wizard_red" ||
  projectile.ExportName !== "ice_wizard_projectile" ||
  projectile.Speed !== "700" ||
  projectile.Damage !== "63" ||
  projectile.Radius !== "1000" ||
  projectile.HitEffect !== "ice_wizard_hit" ||
  projectile.TrailEffect !== "ice_wiz_emitter" ||
  projectile.Homing !== "true" ||
  projectile.BuffTime !== "2000" ||
  buff.HitSpeedMultiplier !== "-35" ||
  buff.SpeedMultiplier !== "-35" ||
  buff.SpawnSpeedMultiplier !== "-35" ||
  buff.FilterExportName !== "filter_cold" ||
  buff.AudioPitchModifier !== "75" ||
  !sprite.names.ice_wizard_attack1_1 ||
  !sprite.names.ice_wizard_red_run1_1
)
  throw new Error("Recheck archived Ice Wizard card, projectile, buff and sprite");

const outputPath = "src/game/ice-wizard-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: card.Name,
      character: unit.Name,
      projectile: projectile.Name,
      buff: buff.Name,
      rarity: card.Rarity,
      cost: Number(card.ManaCost),
      sourceHitpoints: Number(unit.Hitpoints),
      sourceDamage: Number(projectile.Damage),
      sourceSpeed: Number(unit.Speed),
      sourceRange: Number(unit.Range),
      sourceHitSpeed: Number(unit.HitSpeed),
      hitsAir: unit.AttacksAir === "true",
      projectileSpeed: Number(projectile.Speed),
      projectileRadius: Number(projectile.Radius) / 1000,
      projectileExport: projectile.ExportName,
      projectileHitEffect: projectile.HitEffect,
      projectileTrailEffect: projectile.TrailEffect,
      slowDuration: Number(projectile.BuffTime) / 1000,
      speedMultiplier: 1 + Number(buff.SpeedMultiplier) / 100,
      hitSpeedMultiplier: 1 + Number(buff.HitSpeedMultiplier) / 100,
      spawnSpeedMultiplier: 1 + Number(buff.SpawnSpeedMultiplier) / 100,
      filterExport: buff.FilterExportName,
      audioPitchMultiplier: Number(buff.AudioPitchModifier) / 100,
      blueExport: unit.BlueExportName,
      redExport: unit.RedExportName,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/ice-wizard-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      binarySource:
        "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_ice_wizard",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Ice Wizard card, projectile, buff and sprite rules.");
