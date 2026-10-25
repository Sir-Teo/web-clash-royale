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
  "reference/sc/building_firespirit_hut.bin",
  "reference/sc/building_firespirit_hut_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "FirespiritHut");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const spirit = csvRows(inputs[2].toString()).find((row) => row.Name === "FireSpirits");
const effects = csvGroups(inputs[3].toString());
const sounds = csvGroups(inputs[4].toString());
const model = parseSC(inputs[5]);
const portraits = parseSC(inputs[7]);
const blue = model.clips[model.names.firespirit_hut_blue];
const red = model.clips[model.names.firespirit_hut_red];
if (card?.IconFile !== "firespirit_hut" || card.Rarity !== "Rare" ||
    card.ManaCost !== "4" || building?.Hitpoints !== "600" ||
    building.DeployTime !== "1000" || building.LifeTime !== "50000" ||
    building.SpawnNumber !== "2" || building.SpawnInterval !== "500" ||
    building.SpawnPauseTime !== "9400" ||
    building.SpawnCharacter !== "FireSpirits" ||
    building.SpawnCharacterLevelIndex !== "2" ||
    building.ProjectileStartRadius !== "400" ||
    building.SpawnEffect !== "Firespirit_building_spawn" ||
    building.DeathEffect !== "goblin_hut_die" ||
    spirit?.DeployTime !== "1000" || spirit.DeployDelay !== "400" ||
    !effects.Firespirit_building_spawn || !effects.goblin_hut_die ||
    !sounds.sound_firespirit_building_spawn || !sounds.sound_goblin_hut_die ||
    !portraits.names.firespirit_hut ||
    blue?.frames.length !== 300 || red?.frames.length !== 300 ||
    blue.fps !== 30 || red.fps !== 30 ||
    blue.labels.action_frame !== 13 || red.labels.action_frame !== 13)
  throw new Error("Recheck archived Furnace wave timing, character, and art");

const outputPath = "src/game/furnace-data.json";
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
  spiritDeployTime: Number(spirit.DeployTime) / 1000,
  spiritDeployDelay: Number(spirit.DeployDelay) / 1000,
  spawnRadius: Number(building.ProjectileStartRadius) / 1000,
  actionFrame: blue.labels.action_frame,
  fps: blue.fps,
  frames: blue.frames.length,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
  spawnEffect: building.SpawnEffect,
  deathEffect: building.DeathEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/furnace-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Furnace wave rules, animation, and effects.");
