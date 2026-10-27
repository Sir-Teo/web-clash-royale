import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/targetless-policy-native-trace.json",
  "reference/client/target-loss-clock-native-trace.json",
  "reference/client/target-loss-request-native-trace.json",
  "src/game/combat-data.json",
  "reference/logic/characters.csv",
  "reference/logic/buildings.csv",
  "reference/logic/projectiles.csv",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [policy, clock, requests] = bytes
  .slice(0, 3)
  .map((value) => JSON.parse(value));
for (const capture of [policy, clock, requests]) {
  if (
    capture.sha256 !==
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
  )
    throw new Error("Recheck target-loss native binary");
  for (const entry of capture.inputs)
    if (sha256(await readFile(entry.path)) !== entry.sha256)
      throw new Error(`Target-loss input differs: ${entry.path}`);
}
if (
  policy.cases.length !== 63 ||
  clock.cases.length !== 156 ||
  requests.cases.length !== 96
)
  throw new Error("Recheck target-loss native inventory");
const combat = JSON.parse(bytes[3]);
const rows = Object.fromEntries(
  bytes.slice(4, 6).flatMap((value) =>
    csvRows(value.toString())
      .filter((row) => row.Name)
      .map((row) => [row.Name, row]),
  ),
);
const projectileRows = Object.fromEntries(
  csvRows(bytes[6].toString())
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const modes = {};
for (const profile of Object.values(combat)) {
  const row = rows[profile.source];
  const mode =
    row.SelfAsAoeCenter.toLowerCase() === "true"
      ? "self"
      : row.Projectile &&
          projectileRows[row.Projectile].Homing.toLowerCase() !== "true"
        ? "point"
        : undefined;
  if (!mode) continue;
  const decision = policy.cases.find(
    (sample) => sample.sourceName === profile.source,
  );
  const witnesses = clock.cases.filter(
    (sample) => sample.sourceName === profile.source,
  );
  if (
    decision?.callerBranch !== "active" ||
    witnesses.length !== 16 ||
    witnesses.some(
      (sample) =>
        sample.pulses.filter((pulse) => pulse.target === null).length !== 1,
    )
  )
    throw new Error(`Target-loss clock contract differs: ${profile.source}`);
  const packetWitnesses = requests.cases.filter(
    (sample) => sample.sourceName === profile.source,
  );
  if (packetWitnesses.length < 12)
    throw new Error("Target-loss request witness is missing");
  for (const sample of packetWitnesses) {
    const packet = sample.requests.find(
      (entry) => entry.kind === (mode === "self" ? "area" : "shoot"),
    );
    if (!packet || (mode === "point" && packet.arguments[2] !== 0))
      throw new Error("Native null-target request differs");
    const point = mode === "self" ? sample.casterPoint : sample.cachedPoint;
    const offset = mode === "self" ? 1 : 3;
    if (
      packet.arguments[offset] !== point.x ||
      packet.arguments[offset + 1] !== point.y
    )
      throw new Error("Native target-loss request point differs");
  }
  modes[profile.source] = mode;
}
if (
  Object.keys(modes).length !== 7 ||
  modes.Valkyrie !== "self" ||
  modes.AxeMan !== "point"
)
  throw new Error("Recheck target-loss source profiles");
const outputPath = "src/game/target-loss-data.json";
const output = Buffer.from(JSON.stringify({ modes }, null, 2) + "\n");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/target-loss-manifest.json",
  JSON.stringify(
    {
      source: policy.source,
      nativeSha256: policy.sha256,
      inputs: paths.map((path, index) => ({
        path,
        sha256: sha256(bytes[index]),
      })),
      output: { path: outputPath, sha256: sha256(output) },
      scope:
        "One pending attack after victim death/removal on the existing browser scheduler and flight model; complete native owner/retarget/finish scheduling remains separate",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ profiles: Object.keys(modes).length, modes }));
