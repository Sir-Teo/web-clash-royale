import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/client/sounds.csv",
  "reference/sc/building_goblin_hut.bin",
  "reference/sc/building_goblin_hut_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "GoblinHut");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const effects = csvGroups(inputs[2].toString());
const sounds = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
const blue = model.clips[model.names.building_goblinHut_player];
const red = model.clips[model.names.building_goblinHut_enemy];
if (card?.IconFile !== "fire_furnace" || card.Rarity !== "Rare" ||
    card.ManaCost !== "5" || building?.Hitpoints !== "700" ||
    building.DeployTime !== "1000" || building.LifeTime !== "60000" ||
    building.SpawnNumber !== "1" || building.SpawnPauseTime !== "4950" ||
    building.SpawnCharacter !== "SpearGoblin" ||
    building.SpawnCharacterLevelIndex !== "2" ||
    building.ProjectileStartRadius !== "400" ||
    building.SpawnEffect !== "goblin_hut_deploy" ||
    building.DeathEffect !== "goblin_hut_die" ||
    !effects.goblin_hut_deploy || !effects.goblin_hut_die ||
    !sounds.sound_goblin_hut_deploy || !sounds.sound_goblin_hut_die ||
    !portraits.names.fire_furnace ||
    blue?.frames.length !== 5245 || red?.frames.length !== 5245 ||
    blue.fps !== 30 || red.fps !== 30)
  throw new Error("Recheck archived Goblin Hut spawn rules and native art");

const outputPath = "src/game/goblin-hut-data.json";
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
  spawnRadius: Number(building.ProjectileStartRadius) / 1000,
  fps: blue.fps,
  frames: blue.frames.length,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
  spawnEffect: building.SpawnEffect,
  deathEffect: building.DeathEffect,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/goblin-hut-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Goblin Hut spawn rules, animation, and sounds.");
