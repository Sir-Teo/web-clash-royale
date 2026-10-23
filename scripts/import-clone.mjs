import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/character_buffs.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas, buffs] = bytes.map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "Clone");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  !spell ||
  !area ||
  !buff ||
  spell.IconFile !== "copy" ||
  spell.Rarity !== "Epic" ||
  spell.ManaCost !== "3" ||
  spell.Radius !== "3000" ||
  spell.OnlyOwnTroops !== "true" ||
  spell.CastSound !== "SpellCasting" ||
  area.LifeDuration !== "1000" ||
  area.Radius !== "3000" ||
  area.ScaledEffect !== "spell_clone_ground" ||
  area.BuffTime !== "800" ||
  area.OnlyOwnTroops !== "TRUE" ||
  area.IgnoreBuildings !== "TRUE" ||
  area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" ||
  area.Clone !== "TRUE" ||
  area.SpawnDeployBaseAnim !== "filter_hologram" ||
  buff.Clone !== "true" ||
  buff.HitSpeedMultiplier !== "-100" ||
  buff.SpeedMultiplier !== "-100" ||
  buff.SpawnSpeedMultiplier !== "-100"
)
  throw new Error("Recheck archived Clone spell, area and buff rules");

const source = {
  card: spell.Name,
  area: area.Name,
  buff: buff.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  buffDuration: Number(area.BuffTime) / 1000,
  target: "own-troops",
  hitsGround: true,
  hitsAir: true,
  ignoresBuildings: true,
  visual: {
    ground: area.ScaledEffect,
    deployFilter: area.SpawnDeployBaseAnim,
  },
  castSound: spell.CastSound,
};
const path = "src/game/clone-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/clone-manifest.json",
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
console.log("Imported archived Clone spell, area and buff rules.");
