import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_princess.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters, projectiles] = inputs
  .slice(0, 3)
  .map((bytes) => csvRows(bytes.toString()));
const card = spells.find((row) => row.Name === "Princess");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const first = projectiles.find(
  (row) => row.Name === unit?.CustomFirstProjectile,
);
const deco = projectiles.find((row) => row.Name === unit?.Projectile);
const sprite = parseSC(inputs[3]);
if (
  !card ||
  !unit ||
  !first ||
  !deco ||
  card.IconFile !== "princess" ||
  card.Rarity !== "Legendary" ||
  card.ManaCost !== "3" ||
  unit.Hitpoints !== "216" ||
  unit.Speed !== "60" ||
  unit.Range !== "9000" ||
  unit.HitSpeed !== "3000" ||
  unit.MultipleProjectiles !== "5" ||
  unit.AreaDamageRadius !== "2500" ||
  unit.AttacksAir !== "true" ||
  unit.BlueExportName !== "princess" ||
  unit.RedExportName !== "princess_red" ||
  unit.DeployBaseAnimExportName !== "filter_deploy_unit_legendary" ||
  first.Speed !== "450" ||
  first.Damage !== "140" ||
  first.Radius !== "2000" ||
  first.ExportName !== "projectile_princess" ||
  first.HitEffect !== "PrincessArrowHitGround" ||
  first.TrailEffect !== "PrincessArrowProjectileEmitter" ||
  first.AoeToAir !== "true" ||
  first.AoeToGround !== "true" ||
  deco.ExportName !== first.ExportName ||
  deco.HitEffect !== first.HitEffect ||
  deco.Damage ||
  !sprite.names.princess_attack1_1 ||
  !sprite.names.princess_red_run1_1
)
  throw new Error(
    "Recheck archived Princess card, five-arrow volley and sprite",
  );

const outputPath = "src/game/princess-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: card.Name,
      character: unit.Name,
      rarity: card.Rarity,
      cost: Number(card.ManaCost),
      sourceHitpoints: Number(unit.Hitpoints),
      sourceDamage: Number(first.Damage),
      sourceSpeed: Number(unit.Speed),
      sourceRange: Number(unit.Range),
      sourceHitSpeed: Number(unit.HitSpeed),
      splash: Number(unit.AreaDamageRadius) / 1000,
      projectileRadius: Number(first.Radius) / 1000,
      projectileSpeed: Number(first.Speed),
      projectileCount: Number(unit.MultipleProjectiles),
      projectile: first.Name,
      decorativeProjectile: deco.Name,
      projectileExport: first.ExportName,
      hitEffect: first.HitEffect,
      trailEffect: first.TrailEffect,
      hitsAir: unit.AttacksAir === "true",
      blueExport: unit.BlueExportName,
      redExport: unit.RedExportName,
      deployFilter: unit.DeployBaseAnimExportName,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/princess-manifest.json",
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
console.log(
  "Imported archived Princess card, projectile volley and sprite rules.",
);
