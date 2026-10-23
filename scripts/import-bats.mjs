import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_bats.bin",
  "reference/sc/chr_bats_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Bats");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "Bat");
const model = parseSC(inputs[2]);
const portraits = parseSC(inputs[4]);
if (card?.Rarity !== "Common" || card.ManaCost !== "2" ||
    card.SummonCharacter !== "Bat" || card.SummonNumber !== "5" ||
    card.SummonRadius !== "750" || card.IconFile !== "bats" ||
    unit?.Hitpoints !== "32" || unit.Damage !== "32" ||
    unit.Speed !== "120" || unit.HitSpeed !== "1000" ||
    unit.LoadTime !== "500" || unit.Range !== "1200" ||
    unit.AttacksGround !== "true" || unit.AttacksAir !== "true" ||
    unit.FlyingHeight !== "2000" || unit.AttackDashTime !== "150" ||
    unit.DeployDelay !== "400" || unit.LoopingFilter !== "filter_wiggle" ||
    unit.FileName !== "sc/chr_bats.sc" ||
    !model.names.bat_attack1_1 || !model.names.bat_run1_9 ||
    !portraits.names.bats)
  throw new Error("Recheck archived Bats card, creature and sprite");
const outputPath = "src/game/bats-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  source: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  summonRadius: Number(card.SummonRadius) / 1000,
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  sourceRange: Number(unit.Range) / 1000,
  flyingHeight: Number(unit.FlyingHeight) / 1000,
  attackDashTime: Number(unit.AttackDashTime) / 1000,
  deployDelay: Number(unit.DeployDelay) / 1000,
  loopingFilter: unit.LoopingFilter,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bats-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_bats",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Bats creature and swarm rules.");
