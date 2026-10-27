import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const path = "reference/client/first-attacks-native-trace.json";
const bytes = await readFile(path);
const trace = JSON.parse(bytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (
  trace.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  trace.stepMs !== 50 ||
  trace.steps !== 240
)
  throw new Error("Recheck pinned native attack-clock profile");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error("Source tables differ from native attack-clock capture");
const deltasMs = {};
for (const [mode, buffs] of [
  ["normal", []],
  ["rage", ["Rage"]],
  ["slow", ["IceWizardSlowDown"]],
  ["both", ["Rage", "IceWizardSlowDown"]],
]) {
  const cases = trace.cases.filter(
    (sample) => JSON.stringify(sample.buffs) === JSON.stringify(buffs),
  );
  if (
    cases.length !== 28 ||
    new Set(cases.map((sample) => sample.sourceName)).size !== 14
  )
    throw new Error("Recheck native attack-clock source coverage");
  const measured = cases.map((sample) => {
    if (
      !sample.pulses.length ||
      sample.syntheticFirstLoad !== sample.loadFirstHit
    )
      throw new Error("Recheck native attack constructor controls");
    const [previous, last] = sample.checkpoints.slice(-2);
    const delta =
      (last.elapsedMs - previous.elapsedMs) / (last.tick - previous.tick);
    if (
      previous.tick !== 200 ||
      last.tick !== 240 ||
      !Number.isInteger(delta) ||
      delta <= 0
    )
      throw new Error("Recheck uninterrupted native attack-clock measurements");
    return delta;
  });
  if (new Set(measured).size !== 1)
    throw new Error("Native attack clocks disagree across source profiles");
  deltasMs[mode] = measured[0];
}
if (deltasMs.normal !== trace.stepMs)
  throw new Error("Unexpected unmodified native clock");
const outputPath = "src/game/attack-clock-data.json";
const output = Buffer.from(
  JSON.stringify({ stepMs: trace.stepMs, deltasMs }, null, 2) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/attack-clock-manifest.json",
  JSON.stringify(
    {
      source: trace.source,
      nativeSha256: trace.sha256,
      inputs: [...trace.inputs, { path, sha256: sha256(bytes) }],
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Imported common native attack-clock deltas from fourteen source profiles.",
);
