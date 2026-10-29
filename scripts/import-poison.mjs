import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/area_effect_objects.csv",
  "reference/logic/character_buffs.csv",
  "reference/client/buff-ticks-native-trace.json",
  "reference/client/buff-lifecycle-native-trace.json",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, areas, buffs] = bytes.slice(0, 3).map((input) => csvRows(input.toString()));
const trace = JSON.parse(bytes[3]);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
if (trace.sha256 !== "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746")
  throw new Error("Recheck native buff binary");
for (const input of trace.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Native buff input differs: ${input.path}`);
const spell = spells.find((row) => row.Name === "Poison");
const area = areas.find((row) => row.Name === spell?.AreaEffectObject);
const buff = buffs.find((row) => row.Name === area?.Buff);
if (
  !spell || !area || !buff ||
  spell.IconFile !== "poison" ||
  spell.Rarity !== "Epic" ||
  spell.ManaCost !== "4" ||
  spell.AreaEffectObject !== "Poison" ||
  area.Radius !== "3500" ||
  area.LifeDuration !== "8000" ||
  area.HitSpeed !== "250" ||
  area.BuffTime !== "1000" ||
  area.OnlyEnemies !== "TRUE" ||
  area.HitsGround !== "TRUE" ||
  area.HitsAir !== "TRUE" ||
  area.AffectsHidden ||
  area.IgnoreBuildings ||
  area.NoEffectToCrownTowers ||
  buff.DamagePerSecond !== "57" ||
  buff.HitFrequency !== "1000" ||
  buff.CrownTowerDamagePercent !== "-60"
) throw new Error("Recheck archived Poison card, area and buff rules");
const profile = trace.profiles.find((r) => r.sourceName === buff.Name);
if (profile?.damage !== 57 || profile.frequencyMs !== 1000 || profile.percent !== -60)
  throw new Error("Recheck native Poison source binding");
for (const target of ["PrincessTower", "KingTower"]) {
  const witness = trace.controls.find((r) =>
    r.fields.sourceName === buff.Name && r.fields.targetSource === target &&
    r.fields.damage === 121 && r.fields.percent === -60 &&
    r.fields.frequencyMs === 1000 && r.frames.length === 1);
  const requests = witness?.frames[0].events.filter((e) => e[0] === "damage");
  if (requests?.length !== 1 || requests[0][1] !== 49)
    throw new Error("Native normalized Poison Crown witness differs");
}
const lifecycle = JSON.parse(bytes[4]);
if (lifecycle.sha256 !== trace.sha256 || lifecycle.profiles.target !== "Tesla" || lifecycle.profiles.buff !== buff.Name)
  throw new Error("Recheck native retained Poison profile");
for (const input of lifecycle.inputs)
  if (sha256(await readFile(input.path)) !== input.sha256)
    throw new Error(`Retained Poison input differs: ${input.path}`);
for (const damage of [57, 121]) {
  const witness = lifecycle.cases.find((r) =>
    r.fields.damage === damage && r.fields.level === 0 &&
    r.fields.counter === 15 && r.fields.progress === 600);
  const hit = witness?.frames.find((f) =>
    f.hiddenBefore && f.ordinaryHitBlocked &&
    f.events.some((e) => e[0] === "hp" && e[1] === 450 - damage));
  if (!hit) throw new Error("Native retained Poison HP witness differs");
}

const source = {
  card: spell.Name,
  area: area.Name,
  buff: buff.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  radius: Number(area.Radius) / 1000,
  duration: Number(area.LifeDuration) / 1000,
  areaHitInterval: Number(area.HitSpeed) / 1000,
  buffDuration: Number(area.BuffTime) / 1000,
  damagePerSecond: Number(buff.DamagePerSecond),
  damageInterval: Number(buff.HitFrequency) / 1000,
  crownTowerDamageFraction: 1 + Number(buff.CrownTowerDamagePercent) / 100,
  crownTowerDamagePercent: Number(buff.CrownTowerDamagePercent),
  targets: "enemy",
  hitsGround: true,
  hitsAir: true,
  affectsBuildings: true,
  affectsHidden: false,
};
const path = "src/game/poison-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
await writeFile(path, output);
await writeFile(
  "reference/client/poison-manifest.json",
  JSON.stringify({
    source: "https://github.com/smlbiobot/cr",
    commit: "7fc7687e6de74690e902543ee4b59f562121e225",
    crownArithmetic: "ceil(nonnegative integer damage * max(0, 100 + percent) / 100)",
    nativeHelper: "0x1d7e36..0x1d7eb4",
    nativeRetainedTick: {
      target: "Tesla",
      componentPhases: "0x21aa0c..0x21aa54",
      buffManager: "0x25b18e..0x25b216",
      hideClock: "0x216b6c..0x216ccc",
    },
    scope: "Native periodic buff Crown arithmetic and retained Poison HP on hidden Tesla applied to existing normalized damage; level projection, natural status application and full actor/world lifecycle remain excluded.",
    inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
    output: { path, sha256: sha256(output) },
  }, null, 2) + "\n",
);
console.log("Imported archived Poison card, area and buff rules.");
