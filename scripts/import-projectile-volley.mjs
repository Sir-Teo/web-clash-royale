import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";
const paths = [
  "reference/client/attack-projectile-goals-native-trace.json",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "src/game/combat-data.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const capture = JSON.parse(bytes[0]);
if (
  capture.sha256 !==
  "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Recheck volley binary");
for (const input of capture.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Volley source differs: ${input.path}`);
if (
  capture.profiles.length !== 27 ||
  capture.cases.length !== 324 ||
  capture.controls.length !== 52
)
  throw new Error("Recheck volley inventory");
let requests = 0;
for (const sample of [...capture.cases, ...capture.controls]) {
  const n = Math.max(1, sample.fields.count);
  const shots = sample.requests.filter((r) => r.kind === "shoot");
  if (
    shots.length !== n ||
    sample.rngRequests.length !== n - 1 ||
    !sample.unrelatedHeapUnchanged
  )
    throw new Error("Recheck volley requests");
  const factories = sample.requests.filter((r) => r.kind === "factory");
  for (let i = 0; i < n; i++) {
    let dx = 0,
      dy = 0;
    if (i) {
      const q = sample.fields.areaRadius >> 2;
      const draw = sample.rngRequests[i - 1];
      if (
        draw.upperExclusive !== sample.fields.areaRadius - q ||
        draw.providedResult < 0 ||
        draw.providedResult >= draw.upperExclusive
      )
        throw new Error("Recheck volley RNG");
      const radius = q + draw.providedResult;
      const angle = (i * Math.floor(360 / n) * Math.PI) / 180;
      dx = Math.trunc((radius * Math.round(Math.cos(angle) * 1024)) / 1024);
      dy = Math.trunc((radius * Math.round(Math.sin(angle) * 1024)) / 1024);
    }
    const goal =
      sample.fields.rawPointOverride > 0
        ? sample.alternatePoint
        : { x: sample.cachedPoint.x + dx, y: sample.cachedPoint.y + dy };
    if (
      shots[i].arguments[3] !== goal.x ||
      shots[i].arguments[4] !== goal.y ||
      shots[i].selectedData !== factories[i].arguments[0]
    )
      throw new Error("Native volley geometry differs");
    requests++;
  }
}
if (requests !== 584) throw new Error("Recheck volley request count");
const rows = csvRows(bytes[1].toString());
const row = rows.find((r) => r.Name === "Princess");
const profile = capture.profiles.find((p) => p.sourceName === "Princess");
const projectiles = csvRows(bytes[2].toString());
const combat = JSON.parse(bytes[3]);
if (
  profile.count !== 5 ||
  profile.areaRadius !== 2500 ||
  profile.primary !== row.Projectile ||
  profile.customFirst !== row.CustomFirstProjectile ||
  Number(row.MultipleProjectiles) !== profile.count ||
  Number(row.AreaDamageRadius) !== profile.areaRadius ||
  combat.princess.source !== row.Name ||
  capture.profiles.filter((p) => p.count > 1).length !== 1
)
  throw new Error("Recheck Princess source contract");
const damaging = projectiles.find((p) => p.Name === profile.customFirst);
const decorative = projectiles.find((p) => p.Name === profile.primary);
if (
  Number(decorative.Damage) !== 0 ||
  Number(damaging.Damage) <= 0 ||
  Number(damaging.Radius) !== 2000
)
  throw new Error("Recheck projectile roles");
const outputPath = "src/game/projectile-volley-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      sourceUnitsPerTile: 1000,
      volleys: {
        Princess: {
          count: profile.count,
          areaRadius: profile.areaRadius,
          firstProjectile: profile.customFirst,
          decorativeProjectile: profile.primary,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(outputPath, output);
await writeFile(
  "reference/client/projectile-volley-manifest.json",
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
        "Native circular offsets and four bounded draws using a persisted per-body browser LCG stream seeded from match seed and entity ID; continuous cached aim and existing flight/scheduler retained, without native RNG stream parity",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ profiles: 1, requests }));
