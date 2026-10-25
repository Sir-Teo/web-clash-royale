import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_zap_machine.bin",
  "reference/sc/effects.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "ZapMachine");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "ZapMachine");
const projectile = csvRows(inputs[2].toString()).find((row) => row.Name === "ZapMachineProjectile");
const sprite = parseSC(inputs[3]);
const effects = parseSC(inputs[4]);
if (
  card?.Rarity !== "Legendary" || card.ManaCost !== "6" ||
  card.IconFile !== "zapMachine" || card.SummonCharacter !== "ZapMachine" ||
  unit?.Hitpoints !== "1200" || unit.HitSpeed !== "5000" ||
  unit.LoadTime !== "4500" || unit.LoadFirstHit !== "true" ||
  unit.Speed !== "45" || unit.Range !== "4500" ||
  unit.AttackPushBack !== "750" ||
  unit.Projectile !== "ZapMachineProjectile" || unit.AttacksGround !== "true" ||
  unit.AttacksAir === "true" || unit.IgnorePushback !== "true" ||
  unit.ProjectileStartRadius !== "1200" || unit.ProjectileStartZ !== "1800" ||
  unit.LoadAttackEffect1 !== "zapmachine_load_weapon_1" ||
  unit.LoadAttackEffect2 !== "zapmachine_load_weapon_2" ||
  unit.LoadAttackEffect3 !== "zapmachine_load_weapon_3" ||
  unit.LoadAttackEffectReady !== "zapmachine_load_weapon" ||
  projectile?.Speed !== "1400" || projectile.Damage !== "1300" ||
  projectile.Radius !== "1800" || projectile.Homing !== "true" ||
  projectile.AoeToGround !== "true" || projectile.AoeToAir === "true" ||
  projectile.ExportName !== "zapMachine_projectile" ||
  projectile.HitEffect !== "zapmachine_projectile_hit" ||
  projectile.TrailEffect !== "zapMachine_trail_emitter" ||
  !sprite.names.ZapMachine_Blue_idle1_1 ||
  !sprite.names.ZapMachine_attack1_1 ||
  !effects.names.zapMachine_projectile
) throw new Error("Recheck archived Sparky card, charge, projectile and art");

const outputPath = "src/game/sparky-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  loadsBeforeFirstHit: unit.LoadFirstHit === "true",
  ignoresPushback: unit.IgnorePushback === "true",
  pushback: Number(unit.AttackPushBack) / 1000,
  projectileStart: {
    radius: Number(unit.ProjectileStartRadius) / 1000,
    height: Number(unit.ProjectileStartZ) / 1000,
  },
  chargeEffects: [unit.LoadAttackEffect1, unit.LoadAttackEffect2,
    unit.LoadAttackEffect3, unit.LoadAttackEffectReady],
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  projectile: {
    source: projectile.Name,
    speed: Number(projectile.Speed) / 60,
    damage: Number(projectile.Damage),
    radius: Number(projectile.Radius) / 1000,
    homing: projectile.Homing === "true",
    hitsGround: projectile.AoeToGround === "true",
    hitsAir: projectile.AoeToAir === "true",
    export: projectile.ExportName,
    hitEffect: projectile.HitEffect,
    trailEffect: projectile.TrailEffect,
  },
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/sparky-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_zap_machine",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Sparky charge and cannon rules.");
