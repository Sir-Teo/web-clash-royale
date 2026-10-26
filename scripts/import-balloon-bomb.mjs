import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/sc/building_mega_bomb.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const unit = csvRows(inputs[0].toString()).find(
  (row) => row.Name === "Balloon",
);
const bomb = csvRows(inputs[1].toString()).find(
  (row) => row.Name === unit?.DeathSpawnCharacter,
);
const effects = csvGroups(inputs[2].toString());
const model = parseSC(inputs[3]);
if (
  unit?.Rarity !== "Epic" ||
  unit.DeathSpawnCharacter !== "BalloonBomb" ||
  bomb?.DeployTime !== "1000" ||
  bomb.DeathDamage !== "205" ||
  bomb.DeathDamageRadius !== "3000" ||
  bomb.AttacksGround !== "true" ||
  bomb.AttacksAir !== "true" ||
  bomb.DeathPushBack ||
  bomb.DeathEffect !== "MegaBombExplodeBalloon" ||
  bomb.SpawnEffect !== "Balloon_Bomb_deploy" ||
  effects.MegaBombExplodeBalloon?.[0].Sound !== "sound_Balloon_Bomb_die" ||
  model.clips[model.names.balloon_bomb_blue]?.frames.length !== 31 ||
  model.clips[model.names.balloon_bomb_red]?.frames.length !== 31
)
  throw new Error("Recheck archived Balloon death bomb");
const outputPath = "src/game/balloon-bomb-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      character: unit.Name,
      bomb: {
        source: bomb.Name,
        delay: Number(bomb.DeployTime) / 1000,
        sourceDamage: Number(bomb.DeathDamage),
        radius: Number(bomb.DeathDamageRadius) / 1000,
        hitsGround: bomb.AttacksGround === "true",
        hitsAir: bomb.AttacksAir === "true",
        blueExport: bomb.BlueExportName,
        redExport: bomb.RedExportName,
        spawnEffect: bomb.SpawnEffect,
        deathEffect: bomb.DeathEffect,
      },
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/balloon-bomb-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Balloon death-bomb rules.");
