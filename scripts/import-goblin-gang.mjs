import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const inputPath = "reference/logic/spells_characters.csv";
const input = await readFile(inputPath);
const rows = csvRows(input.toString());
const gang = rows.find((row) => row.Name === "GoblinGang");
const goblins = rows.find((row) => row.Name === "Goblins");
const spears = rows.find((row) => row.Name === "SpearGoblins");
if (
  !gang ||
  !goblins ||
  !spears ||
  gang.IconFile !== "goblin_gang" ||
  gang.Rarity !== "Common" ||
  gang.ManaCost !== "3" ||
  gang.SummonNumber !== "6" ||
  gang.SummonRadius !== "700" ||
  gang.SummonCharacter !== goblins.SummonCharacter ||
  gang.SummonCharacterSecond !== spears.SummonCharacter ||
  gang.Effect !== "CharacterDeploy"
)
  throw new Error("Recheck archived Goblin Gang and base cards");

const outputPath = "src/game/goblin-gang-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: gang.Name,
      rarity: gang.Rarity,
      cost: Number(gang.ManaCost),
      count: Number(gang.SummonNumber),
      radius: Number(gang.SummonRadius) / 1000,
      characters: [gang.SummonCharacter, gang.SummonCharacterSecond],
      effect: gang.Effect,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/goblin-gang-manifest.json",
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
console.log("Imported archived Goblin Gang card rule.");
