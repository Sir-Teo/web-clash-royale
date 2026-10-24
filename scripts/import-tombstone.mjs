import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/client/sounds.csv",
  "reference/sc/building_tombstone.bin",
  "reference/sc/building_tombstone_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Tombstone");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const effects = csvGroups(inputs[2].toString());
const sounds = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
const blue = model.clips[model.names.building_tombstone_blue];
const red = model.clips[model.names.building_tombstone_red];
if (card?.IconFile !== "tombstone" || card.Rarity !== "Rare" ||
    card.ManaCost !== "3" || building?.Hitpoints !== "240" ||
    building.DeployTime !== "1000" || building.LifeTime !== "40000" ||
    building.SpawnNumber !== "1" || building.SpawnPauseTime !== "2950" ||
    building.SpawnCharacter !== "Skeleton" ||
    building.SpawnCharacterLevelIndex !== "2" ||
    building.DeathSpawnCount !== "4" ||
    building.DeathSpawnCharacter !== "Skeleton" ||
    building.ProjectileStartRadius !== "400" ||
    building.SpawnEffect !== "tombstone_deploy" ||
    building.DeathEffect !== "tombstone_die" ||
    !effects.tombstone_deploy || !effects.tombstone_die ||
    sounds.sound_tombstone_deploy?.[0]?.FileNames !== "sfx/tombstone_deploy_01.wav" ||
    sounds.sound_tombstone_die?.[0]?.FileNames !== "sfx/boulder_impact_01.wav" ||
    !portraits.names.tombstone ||
    blue?.frames.length !== 60 || red?.frames.length !== 70 ||
    blue.fps !== 30 || red.fps !== 30)
  throw new Error("Recheck archived Tombstone spawn, death, and native art");

const outputPath = "src/game/tombstone-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  deployTime: Number(building.DeployTime) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  spawnNumber: Number(building.SpawnNumber),
  spawnPause: Number(building.SpawnPauseTime) / 1000,
  spawnCharacter: building.SpawnCharacter,
  spawnCharacterLevelIndex: Number(building.SpawnCharacterLevelIndex),
  deathSpawnCount: Number(building.DeathSpawnCount),
  deathSpawnCharacter: building.DeathSpawnCharacter,
  spawnRadius: Number(building.ProjectileStartRadius) / 1000,
  fps: blue.fps,
  blueFrames: blue.frames.length,
  redFrames: red.frames.length,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
  spawnEffect: building.SpawnEffect,
  deathEffect: building.DeathEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/tombstone-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Tombstone spawn, death, animation, and sounds.");
