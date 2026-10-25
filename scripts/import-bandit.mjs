import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_bandit.bin",
  "reference/sc/chr_bandit_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Assassin");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "Assassin");
const model = parseSC(inputs[2]);
const portraits = parseSC(inputs[4]);
if (card?.Rarity !== "Legendary" || card.ManaCost !== "3" ||
    card.SummonCharacter !== "Assassin" || card.IconFile !== "bandit" ||
    unit?.Hitpoints !== "750" || unit.Damage !== "160" ||
    unit.Speed !== "90" || unit.Range !== "750" ||
    unit.HitSpeed !== "1000" || unit.LoadTime !== "600" ||
    unit.DashMinRange !== "4000" || unit.DashMaxRange !== "6000" ||
    unit.DashDamage !== "320" || unit.DashCooldown !== "1000" ||
    unit.JumpSpeed !== "500" || unit.DashFilter !== "filter_bandit_charge" ||
    unit.AttacksGround !== "true" || unit.AttacksAir === "true" ||
    !model.names.bandit_dash1_1 || !model.names.bandit_red_dash1_9 ||
    !portraits.names.bandit)
  throw new Error("Recheck archived Bandit card, dash and model");

const outputPath = "src/game/bandit-data.json";
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
  hitsGround: unit.AttacksGround === "true",
  hitsAir: unit.AttacksAir === "true",
  dash: {
    minimum: Number(unit.DashMinRange) / 1000,
    maximum: Number(unit.DashMaxRange) / 1000,
    damage: Number(unit.DashDamage),
    cooldown: Number(unit.DashCooldown) / 1000,
    speed: Number(unit.JumpSpeed) / 60,
    filter: unit.DashFilter,
    startEffect: unit.DashStartEffect,
    travelEffect: unit.DashEffect,
    landingEffect: unit.LandingEffect,
  },
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bandit-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_bandit",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Bandit dash and model.");
