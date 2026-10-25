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
const spell = spells.find((row) => row.Name === "Rage");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  !spell || !area || !buff ||
  spell.IconFile !== "rage" || spell.Rarity !== "Epic" ||
  spell.ManaCost !== "2" || spell.OnlyOwnTroops !== "true" ||
  area.LifeDuration !== "6000" || area.Radius !== "5000" ||
  area.HitSpeed !== "300" || area.BuffTime !== "2000" ||
  area.CapBuffTimeToAreaEffectTime !== "TRUE" ||
  area.OnlyOwnTroops !== "TRUE" ||
  area.HitsGround !== "TRUE" || area.HitsAir !== "TRUE" ||
  buff.HitSpeedMultiplier !== "135" ||
  buff.SpeedMultiplier !== "135" ||
  buff.SpawnSpeedMultiplier !== "135" ||
  buff.AudioPitchModifier !== "125"
) throw new Error("Recheck archived Rage card, area and buff rules");

const source = {
  card: spell.Name,
  area: area.Name,
  buff: buff.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  areaHitInterval: Number(area.HitSpeed) / 1000,
  buffDuration: Number(area.BuffTime) / 1000,
  capBuffToAreaTime: true,
  targets: "friendlyTroops",
  hitsGround: true,
  hitsAir: true,
  hitSpeedMultiplier: Number(buff.HitSpeedMultiplier) / 100,
  speedMultiplier: Number(buff.SpeedMultiplier) / 100,
  spawnSpeedMultiplier: Number(buff.SpawnSpeedMultiplier) / 100,
  audioPitchMultiplier: Number(buff.AudioPitchModifier) / 100,
};
const path = "src/game/rage-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/rage-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Rage card, area and buff rules.");
