import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_royal_giant.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters, projectiles] = bytes
  .slice(0, 3)
  .map((input) => csvRows(input.toString()));
const card = spells.find((row) => row.Name === "RoyalGiant");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const projectile = projectiles.find((row) => row.Name === unit?.Projectile);
const sprite = parseSC(bytes[3]);
if (
  !card ||
  !unit ||
  !projectile ||
  card.IconFile !== "royal_giant" ||
  card.Rarity !== "Common" ||
  card.ManaCost !== "6" ||
  unit.Hitpoints !== "1200" ||
  unit.Speed !== "45" ||
  unit.Range !== "6500" ||
  unit.HitSpeed !== "1700" ||
  unit.TargetOnlyBuildings !== "true" ||
  unit.BlueExportName !== "royalGiant" ||
  unit.RedExportName !== "royalGiant_red" ||
  projectile.ExportName !== "projectile_cannonball_large" ||
  projectile.Speed !== "1000" ||
  projectile.Damage !== "75" ||
  projectile.Homing !== "true" ||
  !sprite.names.royalGiant_attack1_1 ||
  !sprite.names.royalGiant_red_run1_1
)
  throw new Error("Recheck archived Royal Giant card, projectile and sprite");

const outputPath = "src/game/royal-giant-data.json";
const output = Buffer.from(
  JSON.stringify(
    {
      card: card.Name,
      character: unit.Name,
      projectile: projectile.Name,
      rarity: card.Rarity,
      cost: Number(card.ManaCost),
      sourceHitpoints: Number(unit.Hitpoints),
      sourceDamage: Number(projectile.Damage),
      sourceSpeed: Number(unit.Speed),
      sourceRange: Number(unit.Range),
      sourceHitSpeed: Number(unit.HitSpeed),
      projectileSpeed: Number(projectile.Speed),
      projectileExport: projectile.ExportName,
      buildingsOnly: unit.TargetOnlyBuildings === "true",
      blueExport: unit.BlueExportName,
      redExport: unit.RedExportName,
    },
    null,
    2,
  ) + "\n",
);
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
await writeFile(outputPath, output);
await writeFile(
  "reference/client/royal-giant-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      binarySource:
        "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_royal_giant",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Royal Giant card, projectile and sprite rules.");
