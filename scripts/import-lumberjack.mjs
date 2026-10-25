import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/character_buffs.csv",
  "reference/sc/chr_rage_barbarian.bin",
  "reference/sc/building_rage_bottle.bin",
  "reference/sc/effects.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const row = (index, name) => csvRows(inputs[index].toString()).find((r) => r.Name === name);
const card = row(0, "RageBarbarian");
const unit = row(1, "RageBarbarian");
const bottle = row(2, "RageBarbarianBottle");
const area = row(3, "BarbarianRage");
const buff = row(4, "Rage");
const sprite = parseSC(inputs[5]);
const bottleSprite = parseSC(inputs[6]);
if (
  card?.Rarity !== "Legendary" || card.ManaCost !== "4" ||
  card.IconFile !== "rage_barbarian" || card.SummonCharacter !== "RageBarbarian" ||
  unit?.Hitpoints !== "950" || unit.Damage !== "200" ||
  unit.HitSpeed !== "700" || unit.LoadTime !== "300" ||
  unit.Speed !== "120" || unit.Range !== "700" ||
  unit.DeathSpawnCharacter !== "RageBarbarianBottle" ||
  bottle?.DeathAreaEffect !== "BarbarianRage" ||
  bottle.DeathEffect !== "rage_bottle_explode" ||
  bottle.BlueExportName !== "rage_bottle_fall" ||
  area?.LifeDuration !== "7500" || area.Radius !== "5000" ||
  area.HitSpeed !== "300" || area.Buff !== "Rage" ||
  area.BuffTime !== "2000" || area.CapBuffTimeToAreaEffectTime !== "TRUE" ||
  area.OnlyOwnTroops !== "TRUE" || area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" ||
  buff?.HitSpeedMultiplier !== "135" || buff.SpeedMultiplier !== "135" ||
  !sprite.names.rage_barbarian_idle1_1 ||
  !sprite.names.rage_barbarian_red_attack1_1 ||
  !bottleSprite.names.rage_bottle_fall
) throw new Error("Recheck archived Lumberjack, bottle and Rage area");

const outputPath = "src/game/lumberjack-data.json";
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
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  deathBottle: {
    source: bottle.Name,
    export: bottle.BlueExportName,
    impactEffect: bottle.DeathEffect,
    area: bottle.DeathAreaEffect,
    duration: Number(area.LifeDuration) / 1000,
    radius: Number(area.Radius) / 1000,
    hitInterval: Number(area.HitSpeed) / 1000,
    buffTime: Number(area.BuffTime) / 1000,
    capBuffToArea: area.CapBuffTimeToAreaEffectTime === "TRUE",
    hitsGround: area.HitsGround === "TRUE",
    hitsAir: area.HitsAir === "TRUE",
    ownTroopsOnly: area.OnlyOwnTroops === "TRUE",
    speedMultiplier: Number(buff.SpeedMultiplier) / 100,
    hitSpeedMultiplier: Number(buff.HitSpeedMultiplier) / 100,
  },
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/lumberjack-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySources: [
    "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_rage_barbarian",
    "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/building_rage_bottle",
  ],
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Lumberjack death-bottle Rage rules.");
