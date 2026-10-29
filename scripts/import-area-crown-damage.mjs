import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/client/area-crown-native-trace.json",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/spells_other.csv",
  "reference/logic/characters.csv",
];
const bytes = await Promise.all(paths.map((p) => readFile(p)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const trace = JSON.parse(bytes[0]);
if (
  trace.sha256 !==
  "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746"
)
  throw new Error("Recheck native area Crown binary");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Area Crown input differs: ${input.path}`);
const [areas, spells, characters] = bytes
  .slice(1)
  .map((b) => csvRows(b.toString()));
const spell = spells.find((r) => r.Name === "Zap");
const area = areas.find((r) => r.Name === spell?.AreaEffectObject);
const wizard = characters.find((r) => r.Name === "ElectroWizard");
const witness = trace.profiles.find((r) => r.sourceName === area?.Name);
if (
  area?.Name !== "Zap" ||
  area.Damage !== "75" ||
  area.CrownTowerDamagePercent !== "-60" ||
  wizard?.SpawnAreaObject !== "Zap" ||
  wizard.SpawnAreaObjectLevelIndex !== "8" ||
  witness?.damage !== 75 ||
  witness.percent !== -60
)
  throw new Error(
    "Recheck Zap spell, deployment area and native data bindings",
  );
for (const [damage, expected] of [
  [192, 77],
  [161, 65],
]) {
  const control = trace.controls.find(
    (r) => r.fields.damage === damage && r.fields.percent === -60,
  );
  const towers = control?.targets.filter((r) =>
    ["PrincessTower", "KingTower"].includes(r.targetSource),
  );
  if (
    towers?.length !== 2 ||
    towers.some(
      (r) =>
        r.events.length !== 1 ||
        r.events[0][0] !== "hit" ||
        r.events[0][1] !== expected,
    )
  )
    throw new Error("Native area amount witness differs");
}
const path = "src/game/area-crown-damage-data.json";
const output = Buffer.from(
  JSON.stringify(
    { zap: { area: area.Name, percent: Number(area.CrownTowerDamagePercent) } },
    null,
    2,
  ) + "\n",
);
await writeFile(path, output);
await writeFile(
  "reference/client/area-crown-damage-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      arithmetic:
        "ceil(nonnegative integer damage * max(0, 100 + percent) / 100)",
      nativeHelper: "0x1d3cec..0x1d3d6d",
      scope:
        "Source area Crown arithmetic applied to normalized Zap and Electro Wizard deployment Zap damage; native level projection and full area/hit lifetime remain excluded.",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported area Crown arithmetic for Zap and deployment Zap.");
