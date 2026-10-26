import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/characters.csv",
  "src/game/combat-data.json",
  "reference/client/deployment-native-trace.json",
  "reference/client/mixed-deployment-native-trace.json",
  "tests/fixtures/native-mixed-deployment-golden.json",
];
const inputs = paths.map((path) => ({ path, bytes: readFileSync(path) }));
const characters = csvRows(inputs[0].bytes.toString());
const combat = JSON.parse(inputs[1].bytes);
const native = JSON.parse(inputs[3].bytes),
  fixture = JSON.parse(inputs[4].bytes);
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
if (
  native.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  fixture.sha256 !== native.sha256 ||
  native.profile.card !== "GoblinGang" ||
  fixture.cases.length !== 8 ||
  native.profile.count !== 6
)
  throw new Error("Recheck native mixed deployment capture");
for (const entry of native.inputs)
  if (
    createHash("sha256").update(readFileSync(entry.path)).digest("hex") !==
    entry.sha256
  )
    throw new Error(`Native deployment input changed: ${entry.path}`);
for (const [name, delay] of Object.entries(native.profile.deployDelayMs))
  if (Number(characters.find((r) => r.Name === name)?.DeployDelay) !== delay)
    throw new Error(`Native deployment delay changed for ${name}`);
const delaysMs = fixture.cases[0].points.map((p) => p.visualDelayMs);
if (
  delaysMs.length !== 6 ||
  delaysMs.some(
    (delay) => !Number.isInteger(delay) || delay < 0 || delay > 400,
  ) ||
  fixture.cases.some(
    (c) =>
      JSON.stringify(c.points.map((p) => p.visualDelayMs)) !==
      JSON.stringify(delaysMs),
  )
)
  throw new Error("Recheck native mixed visual offsets");
const mixed = { "goblin-gang": { source: native.profile.card, delaysMs } };
const outputPath = "src/game/deployment-visual-data.json";
const output = Buffer.from(JSON.stringify({ cards, mixed }, null, 2) + "\n");
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
        "Homogeneous card groups use floor(DeployDelay * index / count) modulo DeployTime. Goblin Gang uses the captured native angular offset per child. These are presentation offsets; combat clocks remain independent.",
      limits: [
        "Goblin Gang offsets apply to the recovered rules-22 mixed creation order. Earlier rules retain their original presentation metadata.",
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
