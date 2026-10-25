import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const inputPath = "reference/logic/spells_other.csv";
const input = await readFile(inputPath);
const row = csvRows(input.toString()).find((item) => item.Name === "Mirror");
if (
  !row ||
  row.IconFile !== "mirror" ||
  row.Rarity !== "Epic" ||
  row.ManaCost !== "1" ||
  row.Mirror !== "true" ||
  row.CastSound !== "SpellCasting"
)
  throw new Error("Recheck archived Mirror spell rules");

const outputPath = "src/game/mirror-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: row.Name,
      rarity: row.Rarity,
      surcharge: Number(row.ManaCost),
      repeatsPreviousCard: true,
      castSound: row.CastSound,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/mirror-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: [{ path: inputPath, sha256: sha256(input) }],
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Mirror spell rule.");
