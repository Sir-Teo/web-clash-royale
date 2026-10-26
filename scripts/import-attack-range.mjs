import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const path = "reference/client/attack-range-native-trace.json";
const bytes = await readFile(path);
const trace = JSON.parse(bytes);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error("Source tables differ from native attack-range capture");
if (
  trace.addCharacterRangeToRadius !== true ||
  trace.profiles.length !== 13 ||
  trace.profiles.some((profile) =>
    profile.samples.some((sample) => sample.inRange !== sample.offset <= 0),
  )
)
  throw new Error("Recheck native maximum attack-range evidence");
const outputPath = "src/game/attack-range-data.json";
const output = Buffer.from(
  JSON.stringify(
    { ownRadiusFactor: Number(trace.addCharacterRangeToRadius) },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/attack-range-manifest.json",
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
console.log("Imported native maximum attack-range radius factor.");
