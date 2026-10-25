import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/logic/characters.csv",
  "reference/client/effects.csv",
  "reference/client/sounds.csv",
  "reference/sc/building_barbarian_hut.bin",
  "reference/sc/building_barbarian_hut_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "BarbarianHut");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const barbarian = csvRows(inputs[2].toString()).find((row) => row.Name === "Barbarian");
const effects = csvGroups(inputs[3].toString());
const sounds = csvGroups(inputs[4].toString());
const model = parseSC(inputs[5]);
const portraits = parseSC(inputs[7]);
const blue = model.clips[model.names.building_barbarian_hut_blue];
const red = model.clips[model.names.building_barbarian_hut_red];
if (card?.IconFile !== "barbarian_hut" || card.Rarity !== "Rare" ||
    card.ManaCost !== "7" || building?.Hitpoints !== "1100" ||
    building.DeployTime !== "1000" || building.LifeTime !== "60000" ||
    building.SpawnNumber !== "2" || building.SpawnInterval !== "500" ||
    building.SpawnPauseTime !== "13500" ||
    building.SpawnCharacter !== "Barbarian" ||
    building.SpawnCharacterLevelIndex !== "2" ||
    building.ProjectileStartRadius !== "400" ||
    building.SpawnEffect !== "goblin_hut_deploy" ||
    building.DeathEffect !== "goblin_hut_die" ||
    barbarian?.DeployTime !== "1000" || barbarian.DeployDelay !== "400" ||
    !effects.goblin_hut_deploy || !effects.goblin_hut_die ||
    !sounds.sound_goblin_hut_deploy || !sounds.sound_goblin_hut_die ||
    !portraits.names.barbarian_hut ||
    blue?.frames.length !== 1 || red?.frames.length !== 1 ||
    blue.fps !== 30 || red.fps !== 30)
  throw new Error("Recheck archived Barbarian Hut wave rules and native art");

const outputPath = "src/game/barbarian-hut-data.json";
const output = Buffer.from(JSON.stringify({
  sourceCard: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  deployTime: Number(building.DeployTime) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  spawnNumber: Number(building.SpawnNumber),
  spawnInterval: Number(building.SpawnInterval) / 1000,
  spawnPause: Number(building.SpawnPauseTime) / 1000,
  spawnCharacter: building.SpawnCharacter,
  spawnCharacterLevelIndex: Number(building.SpawnCharacterLevelIndex),
  unitDeployTime: Number(barbarian.DeployTime) / 1000,
  unitDeployDelay: Number(barbarian.DeployDelay) / 1000,
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
await writeFile("reference/client/barbarian-hut-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Barbarian Hut wave rules, art, and effects.");
