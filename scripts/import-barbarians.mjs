import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_barbarian.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters] = bytes.slice(0, 2).map((input) => csvRows(input.toString()));
const card = spells.find((row) => row.Name === "Barbarians");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const sprite = parseSC(bytes[2]);
if (
  !card ||
  !unit ||
  card.IconFile !== "barbarians" ||
  card.Rarity !== "Common" ||
  card.ManaCost !== "5" ||
  card.SummonNumber !== "4" ||
  card.SummonCharacter !== "Barbarian" ||
  unit.Hitpoints !== "300" ||
  unit.Damage !== "75" ||
  unit.Speed !== "60" ||
  unit.Range !== "700" ||
  unit.HitSpeed !== "1500" ||
  unit.BlueExportName !== "barbarian1" ||
  unit.RedExportName !== "barbarian1_enemy" ||
  !sprite.names.barbarian1_attack1_1 ||
  !sprite.names.barbarian1_enemy_run1_1
)
  throw new Error("Recheck archived Barbarians card, character and sprite");

const outputPath = "src/game/barbarians-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: card.Name,
      character: unit.Name,
      rarity: card.Rarity,
      cost: Number(card.ManaCost),
      count: Number(card.SummonNumber),
      sourceHitpoints: Number(unit.Hitpoints),
      sourceDamage: Number(unit.Damage),
      sourceSpeed: Number(unit.Speed),
      sourceRange: Number(unit.Range),
      sourceHitSpeed: Number(unit.HitSpeed),
      blueExport: unit.BlueExportName,
      redExport: unit.RedExportName,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/barbarians-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      binarySource:
        "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_barbarian",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Barbarians card, character and sprite rules.");
