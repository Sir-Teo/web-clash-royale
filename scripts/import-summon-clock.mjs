import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/client/spawn-clock-native-trace.json",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const rows = [
  ...csvRows(inputs[0].toString()),
  ...csvRows(inputs[1].toString()),
];
const trace = JSON.parse(inputs[2]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const input of trace.inputs) {
  const index = paths.indexOf(input.path);
  if (index < 0 || sha256(inputs[index]) !== input.sha256)
    throw new Error("Source tables differ from native clock capture");
}
const names = [
  ["witch", "Witch", "Skeleton", "skeletons"],
  ["night-witch", "DarkWitch", "Bat", "bats"],
  ["goblin-hut", "GoblinHut", "SpearGoblin", "spear-goblins"],
  ["tombstone", "Tombstone", "Skeleton", "skeletons"],
  ["furnace", "FirespiritHut", "FireSpirits", "fire-spirits"],
  ["barbarian-hut", "BarbarianHut", "Barbarian", "barbarians"],
];
const profiles = {};
for (const [id, name, sourceChild, child] of names) {
  const row = rows.find((row) => row.Name === name),
    sample = trace.cases.find((c) => c.name === id);
  if (!row || row.SpawnCharacter !== sourceChild || !sample)
    throw new Error("Recheck source summoner");
  const start = Number(row.SpawnStartTime || 0),
    interval = Number(row.SpawnInterval || 0),
    count = Number(row.SpawnNumber || 0),
    pause = Number(row.SpawnPauseTime || 0);
  if (
    start !== sample.startMs ||
    interval !== sample.intervalMs ||
    count !== sample.count ||
    pause !== sample.pauseMs ||
    !(count > 0 && pause > 0)
  )
    throw new Error("Recheck native summoner clock profile");
  profiles[id] = {
    source: name,
    child,
    start: Math.max(0, start) / 1000,
    interval: interval / 1000,
    count,
    pause: pause / 1000,
  };
}
const outputPath = "src/game/summon-clock-data.json";
const output = Buffer.from(JSON.stringify(profiles, null, 2) + "\n");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/summon-clock-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(inputs[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported six native summoner clock profiles.");
