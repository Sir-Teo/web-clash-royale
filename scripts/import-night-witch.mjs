import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/client/effects.csv",
  "reference/client/particle_emitters.csv",
  "reference/sc/chr_dark_witch.bin",
  "reference/sc/chr_dark_witch_highres_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "DarkWitch");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "DarkWitch");
const effect = csvRows(inputs[2].toString()).find((row) => row.Name === "bat_dark_witch_spawn");
const emitter = csvRows(inputs[3].toString()).find((row) => row.Name === "bat_DW_spawn");
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
if (card?.Rarity !== "Legendary" || card.ManaCost !== "4" ||
    card.SummonCharacter !== "DarkWitch" || card.IconFile !== "dark_witch" ||
    unit?.Hitpoints !== "750" || unit.Damage !== "285" ||
    unit.Speed !== "60" || unit.Range !== "1850" ||
    unit.HitSpeed !== "1500" || unit.LoadTime !== "900" ||
    unit.AttacksGround !== "true" || unit.AttacksAir === "true" ||
    unit.SpawnCharacter !== "Bat" || unit.SpawnNumber !== "2" ||
    unit.SpawnPauseTime !== "5000" || unit.SpawnRadius !== "1500" ||
    unit.SpawnCharacterEffect !== "bat_dark_witch_spawn" ||
    unit.DeathSpawnCount !== "4" || unit.DeathSpawnCharacter !== "Bat" ||
    unit.DeathSpawnRadius !== "2500" || unit.SpawnAngleShift !== "90" ||
    unit.DeathSpawnPushback !== "TRUE" ||
    effect?.Time !== "300" || effect.ParticleEmitterName !== "bat_DW_spawn" ||
    emitter?.ParticleExportName !== "d3" || emitter.ParticleCount !== "16" ||
    !model.names.dark_witch_idle1_1 || !model.names.dark_witch_red_run1_9 ||
    !portraits.names.dark_witch)
  throw new Error("Recheck archived Night Witch, Bat summons and model");

const outputPath = "src/game/night-witch-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  hitsGround: unit.AttacksGround === "true",
  hitsAir: unit.AttacksAir === "true",
  spawn: {
    character: unit.SpawnCharacter,
    count: Number(unit.SpawnNumber),
    pause: Number(unit.SpawnPauseTime) / 1000,
    radius: Number(unit.SpawnRadius) / 1000,
    effect: unit.SpawnCharacterEffect,
    effectDelay: Number(effect.Time) / 1000,
  },
  deathSpawn: {
    character: unit.DeathSpawnCharacter,
    count: Number(unit.DeathSpawnCount),
    radius: Number(unit.DeathSpawnRadius) / 1000,
    angleShift: Number(unit.SpawnAngleShift),
    pushback: unit.DeathSpawnPushback === "TRUE",
  },
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/night-witch-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_dark_witch",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Night Witch and Bat summon rules.");
