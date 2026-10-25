import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/client/effects.csv",
  "reference/client/sounds.csv",
  "reference/sc/chr_skeleton_warrior.bin",
  "reference/sc/chr_skeleton_warrior_highres_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "SkeletonWarriors");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const effects = csvGroups(inputs[2].toString());
const sounds = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
if (card?.IconFile !== "skeleton_warriors" || card.Rarity !== "Epic" ||
    card.ManaCost !== "3" || card.SummonNumber !== "3" ||
    unit?.Hitpoints !== "65" || unit.ShieldHitpoints !== "150" ||
    unit.Damage !== "65" || unit.Speed !== "90" ||
    unit.Range !== "1600" || unit.HitSpeed !== "1200" ||
    unit.LoadTime !== "800" || unit.DeployTime !== "1000" ||
    unit.DeployDelay !== "400" || unit.SpawnRadius !== "800" ||
    unit.HealthBar !== "Shield_small" ||
    unit.ShieldLostEffect !== "skeleton_warrior_lose_shield" ||
    unit.BlueExportName !== "skeletonWarrior_blue" ||
    unit.RedExportName !== "skeletonWarrior" ||
    unit.BlueShieldExportName !== "skeletonWarrior_blue_shield" ||
    unit.RedShieldExportName !== "skeletonWarrior_shield" ||
    effects.skeleton_warrior_lose_shield?.[0].Sound !== "sound_skeleton_warrior_lose_shield" ||
    sounds.sound_skeleton_warrior_lose_shield?.[0].FileNames !== "sfx/shield_skele_lost_02.wav" ||
    !model.names.skeletonWarrior_blue_shield_run1_9 ||
    !model.names.skeletonWarrior_shield_attack1_1 ||
    !model.names.skeletonWarrior_blue_run1_9 ||
    !model.names.skeletonWarrior_attack1_1 ||
    !portraits.names.skeleton_warriors)
  throw new Error("Recheck archived Guards card, shield and native artwork");

const outputPath = "src/game/guards-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceShieldHitpoints: Number(unit.ShieldHitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  sourceDeployTime: Number(unit.DeployTime) / 1000,
  deployDelay: Number(unit.DeployDelay) / 1000,
  summonRadius: Number(unit.SpawnRadius) / 1000,
  healthBar: unit.HealthBar,
  shieldBreakEffect: unit.ShieldLostEffect,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
  blueShieldExport: unit.BlueShieldExportName,
  redShieldExport: unit.RedShieldExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/guards-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_skeleton_warrior",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Guards and two native shield states.");
