import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/client/sounds.csv",
  "reference/sc/building_elixir_collector.bin",
  "reference/sc/building_elixir_collector_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Elixir Collector");
const building = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const effects = csvGroups(inputs[2].toString());
const sounds = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
const blue = model.clips[model.names.building_elixir_pump_blue];
const red = model.clips[model.names.building_elixir_pump_red];
if (card?.IconFile !== "building_elixir_collector" || card.Rarity !== "Rare" ||
    card.ManaCost !== "6" || building?.Hitpoints !== "580" ||
    building.DeployTime !== "1000" || building.LifeTime !== "70000" ||
    building.ManaCollectAmount !== "1" || building.ManaGenerateTimeMs !== "8500" ||
    building.DeathEffect !== "elixircollector_die" ||
    building.SpawnEffect !== "elixircollector_deploy" ||
    !effects.elixircollector_deploy || !effects.elixircollector_die ||
    sounds.sound_elixircollector_get?.[0]?.FileNames !== "sfx/get_elixir_02.wav" ||
    !portraits.names.building_elixir_collector ||
    blue?.frames.length !== 35 || red?.frames.length !== 35 ||
    blue.fps !== 30 || red.fps !== 30 ||
    blue.labels.action_frame !== 29 || red.labels.action_frame !== 29)
  throw new Error("Recheck archived Elixir Collector economy and native art");
const outputPath = "src/game/elixir-collector-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(building.Hitpoints),
  deployTime: Number(building.DeployTime) / 1000,
  lifetime: Number(building.LifeTime) / 1000,
  collectAmount: Number(building.ManaCollectAmount),
  generateInterval: Number(building.ManaGenerateTimeMs) / 1000,
  actionFrame: blue.labels.action_frame,
  fps: blue.fps,
  frames: blue.frames.length,
  collectSound: "sound_elixircollector_get",
  spawnEffect: building.SpawnEffect,
  deathEffect: building.DeathEffect,
  blueExport: building.BlueExportName,
  redExport: building.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/elixir-collector-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Elixir Collector economy, animation, and sound.");
