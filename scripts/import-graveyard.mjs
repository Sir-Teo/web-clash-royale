import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Graveyard");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
if (
  !spell ||
  !area ||
  spell.IconFile !== "graveyard" ||
  spell.Rarity !== "Legendary" ||
  spell.ManaCost !== "5" ||
  spell.Radius !== "5000" ||
  spell.Effect !== "Spell_graveyard_cast" ||
  spell.CastSound !== "sound_graveyard_deploy" ||
  area.LifeDuration !== "10000" ||
  area.Radius !== "5000" ||
  area.ScaledEffect !== "Spell_graveyard_ground" ||
  area.SpawnCharacter !== "Skeleton" ||
  area.SpawnInterval !== "500" ||
  area.SpawnEffect !== "Graveyard_appear" ||
  area.SpawnDeployBaseAnim !== "filter_deploy_unit_skeleton" ||
  area.SpawnTime !== "400" ||
  area.SpawnCharacterLevelIndex !== "8" ||
  area.SpawnInitialDelay !== "1500" ||
  area.OnlyOwnTroops !== "TRUE" ||
  area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE"
)
  throw new Error("Recheck archived Graveyard spell and area rules");

const source = {
  card: spell.Name,
  area: area.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  spawnCharacter: area.SpawnCharacter,
  spawnInterval: Number(area.SpawnInterval) / 1000,
  spawnInitialDelay: Number(area.SpawnInitialDelay) / 1000,
  spawnDeployTime: Number(area.SpawnTime) / 1000,
  spawnCharacterLevelIndex: Number(area.SpawnCharacterLevelIndex),
  visual: {
    cast: spell.Effect,
    ground: area.ScaledEffect,
    appear: area.SpawnEffect,
    deployFilter: area.SpawnDeployBaseAnim,
  },
  castSound: spell.CastSound,
};
const path = "src/game/graveyard-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/graveyard-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((inputPath, i) => ({
        path: inputPath,
        sha256: sha256(bytes[i]),
      })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Graveyard spell and area rules.");
