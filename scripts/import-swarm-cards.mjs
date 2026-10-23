import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const inputPath = "reference/logic/spells_characters.csv";
const input = await readFile(inputPath);
const rows = csvRows(input.toString());
const entries = [
  {
    card: "MinionHorde",
    base: "Minions",
    character: "Minion",
    icon: "minion_horde",
    rarity: "Common",
    cost: 5,
    count: 6,
  },
  {
    card: "ThreeMusketeers",
    base: "Musketeer",
    character: "Musketeer",
    icon: "three_musketeers",
    rarity: "Rare",
    cost: 9,
    count: 3,
  },
];
for (const entry of entries) {
  const card = rows.find((row) => row.Name === entry.card);
  const base = rows.find((row) => row.Name === entry.base);
  if (
    !card ||
    !base ||
    card.IconFile !== entry.icon ||
    card.Rarity !== entry.rarity ||
    Number(card.ManaCost) !== entry.cost ||
    Number(card.SummonNumber) !== entry.count ||
    card.SummonCharacter !== entry.character ||
    base.SummonCharacter !== entry.character
  )
    throw new Error(`Recheck archived ${entry.card} and ${entry.base} rules`);
}

const outputPath = "src/game/swarm-cards-data.json";
const output = Buffer.from(
  JSON.stringify(
    Object.fromEntries(
      entries.map(({ card, base, character, icon, rarity, cost, count }) => [
        card,
        { base, character, icon, rarity, cost, count },
      ]),
    ),
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/swarm-cards-manifest.json",
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
console.log("Imported archived Minion Horde and Three Musketeers rules.");
