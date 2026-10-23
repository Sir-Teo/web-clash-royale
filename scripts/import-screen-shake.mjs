import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvGroups } from "./lib/csv.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = [];
async function input(path, parse = JSON.parse) {
  const bytes = await readFile(path);
  sources.push({ path, sha256: hash(bytes) });
  return parse(bytes.toString());
}
const effects = await input("reference/client/effects.csv", csvGroups);
const combat = await input("src/game/combat-audio-data.json");
const deaths = await input("src/game/death-audio-data.json");
const corrections = await input("reference/client/combat-audio-manifest.json");
const native = await input("reference/client/screen-shake-layout.json");
await input("reference/client/screen-shake-native-probe.json");
await input("reference/client/screen-shake-offset-probe.json");
await input("reference/client/screen-shake-scalar-probe.json");
const profiles = {};
const continuationScalars = [];
function composition(name, team, delay = 0, ancestors = []) {
  if (name.startsWith("sound:")) return [];
  let rows = effects[name];
  if (!rows) throw new Error(`Unknown effect ${name}`);
  if (
    team === "red" &&
    rows[0].EnemyVersion &&
    !corrections.ignoredEnemyVersions.some((e) => e.effect === name)
  ) {
    name = rows[0].EnemyVersion;
    rows = effects[name];
  }
  if (!rows || ancestors.includes(name))
    throw new Error(`Invalid effect tree ${name}`);
  // Native construction reads this group-level field immediately; the first
  // row's particle/sound Time does not defer its own shake.
  const scalarRows = rows.flatMap((row, index) =>
    row.ShakeScreen ? [{ index, value: Number(row.ShakeScreen) }] : [],
  );
  if (new Set(scalarRows.map((row) => row.value)).size > 1)
    throw new Error(`Ambiguous ShakeScreen scalar: ${name}`);
  const scalar = scalarRows[0];
  if (
    scalar &&
    scalar.index > 0 &&
    !continuationScalars.some((entry) => entry.effect === name)
  )
    continuationScalars.push({
      effect: name,
      row: scalar.index,
      milliseconds: scalar.value,
      reason:
        "Preserve the unique authored group duration from a continuation row; native blank normalization is not established.",
    });
  const result =
    scalar?.value > 0
      ? [{ effect: name, delay, duration: scalar.value / 1000 }]
      : [];
  for (const row of rows)
    if (row.Type === "Effect" && row.Effect)
      result.push(
        ...composition(row.Effect, team, delay + Number(row.Time) / 1000, [
          ...ancestors,
          name,
        ]),
      );
  return result;
}
for (const [id, profile] of Object.entries(combat.profiles)) {
  const phases = Object.fromEntries(
    Object.entries(profile)
      .filter(([, value]) => Array.isArray(value?.sources))
      .map(([phase, value]) => [phase, value.sources]),
  );
  const death =
    deaths.effects[
      id === "king-tower" ? "king" : id === "princess-tower" ? "tower" : id
    ];
  if (death) phases.death = [death.source];
  const output = {};
  for (const [phase, roots] of Object.entries(phases)) {
    const components = roots.flatMap((name) => composition(name, "blue"));
    const enemyComponents = roots.flatMap((name) => composition(name, "red"));
    if (components.length || enemyComponents.length)
      output[phase] = { sources: roots, components, enemyComponents };
  }
  if (Object.keys(output).length) profiles[id] = output;
}
const constant = (name) => native.constants.find((c) => c.name === name).value;
const data = {
  radiusFactor: constant("remainingTimeToRadiusFactor") * native.scale.value,
  angleFactor: constant("randomIntegerToRadians"),
  profiles,
};
const path = "src/render/screen-shake-data.json";
const output = JSON.stringify(data, null, 2) + "\n";
await writeFile(path, output);
await writeFile(
  "reference/client/screen-shake-manifest.json",
  JSON.stringify(
    { sources, continuationScalars, output: { path, sha256: hash(output) } },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(profiles).length} shaking profiles with native duration, radius and angular scale.`,
);
