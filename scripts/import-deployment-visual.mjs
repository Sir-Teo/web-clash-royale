import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/characters.csv",
  "src/game/combat-data.json",
  "reference/client/deployment-native-trace.json",
];
const inputs = paths.map((path) => ({ path, bytes: readFileSync(path) }));
const characters = csvRows(inputs[0].bytes.toString());
const combat = JSON.parse(inputs[1].bytes);
const cards = {};
for (const [id, profile] of Object.entries(combat)) {
  // Its secondary character uses the native angular/mixed branch, not the
  // homogeneous body-index formula retained in the deployment trace.
  if (id === "goblin-gang" || id.endsWith("-tower")) continue;
  const row = characters.find((r) => r.Name === profile.source);
  const delayMs = Number(row?.DeployDelay),
    deployMs = Number(row?.DeployTime);
  if (delayMs > 0 && deployMs > 0)
    cards[id] = { source: row.Name, delayMs, deployMs };
}
if (
  cards["three-musketeers"]?.delayMs !== 300 ||
  cards.bats?.delayMs !== 400 ||
  cards["minion-horde"]?.source !== "Minion" ||
  cards["goblin-gang"]
)
  throw new Error("Recheck native deployment offset bindings");
const outputPath = "src/game/deployment-visual-data.json";
const output = Buffer.from(JSON.stringify({ cards }, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
writeFileSync(outputPath, output);
writeFileSync(
  "reference/client/deployment-visual-manifest.json",
  JSON.stringify(
    {
      inputs: inputs.map(({ path, bytes }) => ({
        path,
        sha256: sha256(bytes),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      interpretation:
        "Homogeneous card groups use floor(DeployDelay * index / count) modulo DeployTime as a per-body visual offset. Combat clocks remain independent.",
      limits: [
        "Goblin Gang's mixed/angular branch is excluded.",
        "Summons and death spawns retain their existing presentation; this table applies to accepted card groups.",
        "Before the offset elapses, the browser holds the first authored filter pose. Native pre-start visibility is not fully reconstructed.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Retained visual deployment offsets for ${Object.keys(cards).length} actor profiles.`,
);
