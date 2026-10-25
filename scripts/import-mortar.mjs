import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows, csvGroups } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_buildings.csv",
  "reference/logic/buildings.csv",
  "reference/logic/projectiles.csv",
  "reference/client/effects.csv",
  "reference/sc/building_mortar.bin",
  "reference/sc/building_mortar_tex.png",
  "reference/sc/effects.bin",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Mortar");
const unit = csvRows(inputs[1].toString()).find(
  (row) => row.Name === card?.SummonCharacter,
);
const shot = csvRows(inputs[2].toString()).find(
  (row) => row.Name === unit?.Projectile,
);
const effects = csvGroups(inputs[3].toString());
const model = parseSC(inputs[4]);
const projectileArt = parseSC(inputs[6]);
const portraits = parseSC(inputs[7]);
const exports = ["blue", "red"].flatMap((team) =>
  ["idle", "attack"].flatMap((state) =>
    Array.from(
      { length: 5 },
      (_, i) =>
        `building_mortar1${team === "red" ? "_enemy" : ""}_${state}1_${i + 1}`,
    ),
  ),
);
if (
  card?.IconFile !== "building_mortar" ||
  card.Rarity !== "Common" ||
  card.ManaCost !== "4" ||
  unit?.Hitpoints !== "600" ||
  unit.HitSpeed !== "5000" ||
  unit.LoadTime !== "4000" ||
  unit.DeployTime !== "4000" ||
  unit.MinimumRange !== "4500" ||
  unit.Range !== "11500" ||
  unit.LifeTime !== "30000" ||
  unit.AttacksGround !== "true" ||
  unit.AttacksAir === "true" ||
  unit.ProjectileEffect !== "mortar_attack" ||
  unit.DeathEffect !== "mortar_die" ||
  unit.SpawnEffect !== "mortar_deploy" ||
  shot?.Speed !== "300" ||
  shot.Damage !== "108" ||
  shot.Radius !== "2000" ||
  shot.Gravity !== "60" ||
  shot.AoeToGround !== "true" ||
  shot.OnlyEnemies !== "true" ||
  shot.ExportName !== "catapult_projectile1" ||
  !effects.mortar_attack ||
  !effects.mortar_hit ||
  !portraits.names.building_mortar ||
  !projectileArt.names.catapult_projectile1 ||
  exports.some((name) => !model.names[name])
)
  throw new Error("Recheck archived Mortar rules and original artwork");
const outputPath = "src/game/mortar-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: card.Name,
      rarity: card.Rarity,
      cost: Number(card.ManaCost),
      sourceHitpoints: Number(unit.Hitpoints),
      sourceDamage: Number(shot.Damage),
      deployTime: Number(unit.DeployTime) / 1000,
      hitSpeed: Number(unit.HitSpeed) / 1000,
      loadTime: Number(unit.LoadTime) / 1000,
      range: Number(unit.Range) / 1000,
      minimumRange: Number(unit.MinimumRange) / 1000,
      lifetime: Number(unit.LifeTime) / 1000,
      splash: Number(shot.Radius) / 1000,
      projectileSpeed: Number(shot.Speed) / 60,
      gravity: Number(shot.Gravity),
      projectileArt: shot.ExportName,
      projectileShadow: shot.ShadowExportName,
      blueExport: unit.BlueExportName,
      redExport: unit.RedExportName,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/mortar-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Mortar siege rules and source asset hashes.");
