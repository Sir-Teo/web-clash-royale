import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const paths = [
  "reference/client/preload-transition-native-trace.json",
  "src/game/sparky-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [capture, sparky] = bytes.map((buffer) => JSON.parse(buffer));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (
  capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746" ||
  capture.stepMs !== 50 ||
  capture.cases.length !== 120 ||
  !sparky.loadsBeforeFirstHit
)
  throw new Error("Recheck passive preload source");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Preload input differs: ${input.path}`);
const witnesses = capture.cases.filter(
  (row) =>
    row.sourceName === sparky.card && row.scenario !== "range-true-owner1",
);
if (witnesses.length !== 48)
  throw new Error("Recheck passive source witnesses");
const rates = new Set();
for (const row of witnesses) {
  if (!row.loadFirstHit || row.loadTimeMs !== sparky.sourceLoadTime * 1000)
    throw new Error("Sparky preload profile differs");
  const first = row.checkpoints.find(
    (point) => point.tick === 1 && point.phase === "update",
  );
  rates.add((row.constructed.reloadMs - first.reloadMs) / capture.stepMs);
  const end = row.checkpoints.find(
    (point) => point.tick === row.warmSteps && point.phase === "update",
  );
  if (
    end.reloadMs !==
      Math.max(0, row.loadTimeMs - row.warmSteps * capture.stepMs) ||
    end.elapsedMs !== 0
  )
    throw new Error("Passive source clock differs");
}
if (rates.size !== 1 || ![...rates].every((rate) => rate === 1))
  throw new Error("Passive source rate is not uniform");
const outputPath = "src/game/sparky-preload-data.json";
const output = Buffer.from(
  JSON.stringify(
    { stepMs: capture.stepMs, passiveRate: [...rates][0] },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/sparky-preload-manifest.json",
  JSON.stringify(
    {
      source: capture.source,
      nativeSha256: capture.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "Sparky passive preload rate; active attack clocks and browser deployment, target-loss, stun and first-shot scheduling remain separate",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    passiveWitnesses: witnesses.length,
    passiveRate: [...rates][0],
  }),
);
