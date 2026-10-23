import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_barbarian.bin",
  "reference/sc/ui-spells.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(bytes[0].toString()).find((row) => row.Name === "AngryBarbarians");
const unit = csvRows(bytes[1].toString()).find((row) => row.Name === card?.SummonCharacter);
const sprite = parseSC(bytes[2]);
const portraits = parseSC(bytes[3]);
if (
  card?.IconFile !== "angry_barbarian" ||
  card.Rarity !== "Common" ||
  card.ManaCost !== "6" ||
  card.SummonNumber !== "2" ||
  card.SummonRadius !== "700" ||
  unit?.Hitpoints !== "478" ||
  unit.Damage !== "120" ||
  unit.Speed !== "120" ||
  unit.Range !== "1000" ||
  unit.HitSpeed !== "1500" ||
  unit.LoadTime !== "1100" ||
  unit.DeployDelay !== "400" ||
  unit.BlueExportName !== "angry_barbarian" ||
  unit.RedExportName !== "angry_barbarian_red" ||
  !sprite.names.angry_barbarian_attack1_1 ||
  !sprite.names.angry_barbarian_red_run1_1 ||
  !portraits.names.angry_barbarian
)
  throw new Error("Recheck archived Elite Barbarians card, character and artwork");

const outputPath = "src/game/elite-barbarians-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  character: unit.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  count: Number(card.SummonNumber),
  summonRadius: Number(card.SummonRadius) / 1000,
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  deployDelay: Number(unit.DeployDelay) / 1000,
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/elite-barbarians-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_barbarian",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Elite Barbarians rules and source artwork bindings.");
