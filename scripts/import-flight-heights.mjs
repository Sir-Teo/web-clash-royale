import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const sourcePath = "reference/logic/characters.csv";
const outputPath = "src/game/flight-heights.json";
const manifestPath = "reference/client/flight-heights-manifest.json";
const source = await readFile(sourcePath);
const rows = csvRows(source.toString());
const characters = {
  "minions": "Minion",
  "minion-horde": "Minion",
  "mega-minion": "MegaMinion",
  "bats": "Bat",
  "balloon": "Balloon",
  "baby-dragon": "BabyDragon",
  "inferno-dragon": "InfernoDragon",
  "lava-hound": "LavaHound",
  "lava-pup": "LavaPups",
};
const heights = {};
for (const [card, character] of Object.entries(characters)) {
  const row = rows.find((entry) => entry.Name === character);
  const flyingHeight = Number(row?.FlyingHeight) / 1000;
  const projectileStartZ = Number(row?.ProjectileStartZ) / 1000;
  if (!row || !Number.isFinite(flyingHeight) || flyingHeight <= 0 ||
      !Number.isFinite(projectileStartZ))
    throw new Error(`Missing archived flight data for ${card} (${character})`);
  heights[card] = { source: character, flyingHeight, projectileStartZ };
}
const output = Buffer.from(JSON.stringify(heights, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(manifestPath, JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  input: { path: sourcePath, sha256: sha256(source) },
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived flying heights and projectile origins.");
