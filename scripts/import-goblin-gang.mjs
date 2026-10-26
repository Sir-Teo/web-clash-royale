import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const inputPath = "reference/logic/spells_characters.csv";
const input = await readFile(inputPath);
const rows = csvRows(input.toString());
const gang = rows.find((row) => row.Name === "GoblinGang");
const goblins = rows.find((row) => row.Name === "Goblins");
const spears = rows.find((row) => row.Name === "SpearGoblins");
const nativePath = "reference/client/mixed-formation-native-trace.json";
const fixturePath = "tests/fixtures/native-mixed-formation-golden.json";
const nativeInput = await readFile(nativePath);
const fixtureInput = await readFile(fixturePath);
const native = JSON.parse(nativeInput),
  fixture = JSON.parse(fixtureInput);
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
if (
  native.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  fixture.sha256 !== native.sha256 ||
  fixture.cases.length !== 8 ||
  native.profile.primary !== gang.SummonCharacter ||
  native.profile.secondary !== gang.SummonCharacterSecond ||
  native.profile.count !== Number(gang.SummonNumber) ||
  native.profile.radius !== Number(gang.SummonRadius)
)
  throw new Error("Recheck the native mixed formation capture");
const sequence = fixture.cases[0].points.map((p) => p.character);
if (
  sequence.filter((c) => c === gang.SummonCharacter).length !== 3 ||
  sequence.filter((c) => c === gang.SummonCharacterSecond).length !== 3 ||
  fixture.cases.some(
    (c) =>
      JSON.stringify(c.points.map((p) => p.character)) !==
      JSON.stringify(sequence),
  )
)
  throw new Error("Recheck native mixed character order");
for (const entry of native.inputs)
  if (
    createHash("sha256")
      .update(await readFile(entry.path))
      .digest("hex") !== entry.sha256
  )
    throw new Error(`Native formation source changed: ${entry.path}`);

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
      formation: {
        radius: native.profile.radius,
        angleShift: native.profile.angleShift,
        secondaryIndices: sequence.flatMap((character, index) =>
          character === gang.SummonCharacterSecond ? [index] : [],
        ),
      },
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
      inputs: [
        { path: inputPath, sha256: sha256(input) },
        { path: nativePath, sha256: sha256(nativeInput) },
        { path: fixturePath, sha256: sha256(fixtureInput) },
      ],
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Goblin Gang card rule.");
