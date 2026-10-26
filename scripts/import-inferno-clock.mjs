import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const path = "reference/client/inferno-clock-native-trace.json";
const bytes = await readFile(path);
const trace = JSON.parse(bytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error("Source tables differ from native Inferno clock capture");
if (trace.stepMs !== 50)
  throw new Error("Recheck native Inferno update interval");
const deltas = {};
for (const [key, buffs] of [
  ["normal", []],
  ["rage", ["Rage"]],
  ["slow", ["IceWizardSlowDown"]],
  ["both", ["Rage", "IceWizardSlowDown"]],
]) {
  const samples = trace.cases.filter(
    (sample) => JSON.stringify(sample.buffs) === JSON.stringify(buffs),
  );
  if (samples.length !== 2 || samples[0].deltaMs !== samples[1].deltaMs)
    throw new Error("Recheck native Inferno card rate agreement");
  deltas[key] = samples[0].deltaMs;
}
const outputPath = "src/game/inferno-clock-data.json";
const output = Buffer.from(
  JSON.stringify({ stepMs: trace.stepMs, deltasMs: deltas }, null, 2) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/inferno-clock-manifest.json",
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
console.log("Imported captured native Inferno clock deltas.");
