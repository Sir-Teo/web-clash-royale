import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/client/effects.csv",
  "reference/sc/chr_giant_skeleton.bin",
  "reference/sc/chr_giant_skeleton_tex.png",
  "reference/sc/building_mega_bomb.bin",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "GiantSkeleton");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const bomb = csvRows(inputs[2].toString()).find((row) => row.Name === unit?.DeathSpawnCharacter);
const effects = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const bombModel = parseSC(inputs[6]);
const portraits = parseSC(inputs[7]);
if (card?.IconFile !== "giant_skeleton" || card.Rarity !== "Epic" ||
    card.ManaCost !== "6" || card.SummonNumber !== "1" ||
    unit?.Hitpoints !== "2000" || unit.Damage !== "130" ||
    unit.Speed !== "60" || unit.Range !== "800" ||
    unit.HitSpeed !== "1500" || unit.LoadTime !== "1000" ||
    unit.DeployTime !== "1000" || unit.IgnorePushback !== "true" ||
    unit.DeathSpawnCharacter !== "GiantSkeletonBomb" ||
    unit.DeathSpawnCount !== "1" ||
    bomb?.DeployTime !== "3000" || bomb.DeathDamage !== "720" ||
    bomb.DeathDamageRadius !== "3000" || bomb.DeathPushBack !== "1800" ||
    bomb.AttacksGround !== "true" || bomb.AttacksAir !== "true" ||
    bomb.DeathEffect !== "MegaBombExplodeSkeleton" ||
    bomb.SpawnEffect !== "GiantSkeleton_Bomb_deploy" ||
    effects.MegaBombExplodeSkeleton?.[0].Sound !== "sound_GiantSkeleton_bomb_die" ||
    !model.names.giant_skeleton_attack1_1 ||
    !model.names.giant_skeleton_enemy_run1_9 ||
    !portraits.names.giant_skeleton ||
    bombModel.clips[bombModel.names.giant_skeleton_bomb_blue]?.frames.length !== 90 ||
    bombModel.clips[bombModel.names.giant_skeleton_bomb_red]?.frames.length !== 90)
  throw new Error("Recheck archived Giant Skeleton and delayed bomb");

const outputPath = "src/game/giant-skeleton-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  sourceDeployTime: Number(unit.DeployTime) / 1000,
  ignoresPushback: unit.IgnorePushback === "true",
  bomb: {
    source: bomb.Name,
    deployTime: Number(bomb.DeployTime) / 1000,
    sourceDamage: Number(bomb.DeathDamage),
    radius: Number(bomb.DeathDamageRadius) / 1000,
    pushback: Number(bomb.DeathPushBack) / 1000,
    hitsGround: bomb.AttacksGround === "true",
    hitsAir: bomb.AttacksAir === "true",
    blueExport: bomb.BlueExportName,
    redExport: bomb.RedExportName,
    spawnEffect: bomb.SpawnEffect,
    deathEffect: bomb.DeathEffect,
  },
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/giant-skeleton-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_giant_skeleton",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Giant Skeleton and delayed bomb rules.");
