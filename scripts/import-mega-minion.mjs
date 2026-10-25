import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_mega_minion.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, characters, projectiles] = bytes
  .slice(0, 3)
  .map((input) => csvRows(input.toString()));
const card = spells.find((row) => row.Name === "MegaMinion");
const unit = characters.find((row) => row.Name === card?.SummonCharacter);
const projectile = projectiles.find((row) => row.Name === unit?.Projectile);
const sprite = parseSC(bytes[3]);
if (
  !card ||
  !unit ||
  !projectile ||
  card.IconFile !== "mega_minion" ||
  card.Rarity !== "Rare" ||
  card.ManaCost !== "3" ||
  unit.Hitpoints !== "395" ||
  unit.Speed !== "60" ||
  unit.Range !== "2000" ||
  unit.HitSpeed !== "1500" ||
  unit.FlyingHeight !== "1500" ||
  unit.AttacksGround !== "true" ||
  unit.AttacksAir !== "true" ||
  unit.BlueExportName !== "mega_minion" ||
  unit.RedExportName !== "mega_minion_red" ||
  projectile.ExportName !== "projectile_cannonball_small" ||
  projectile.Speed !== "1000" ||
  projectile.Damage !== "147" ||
  projectile.HitEffect !== "mega_minion_hit" ||
  projectile.Homing !== "true" ||
  !sprite.names.mega_minion_attack1_1 ||
  !sprite.names.mega_minion_red_idle1_1
)
  throw new Error("Recheck archived Mega Minion card, projectile and sprite");

const outputPath = "src/game/mega-minion-data.json";
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
      flyingHeight: Number(unit.FlyingHeight),
      hitsAir: unit.AttacksAir === "true",
      projectileSpeed: Number(projectile.Speed),
      projectileExport: projectile.ExportName,
      projectileHitEffect: projectile.HitEffect,
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
  "reference/client/mega-minion-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      binarySource:
        "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_mega_minion",
      inputs: paths.map((path, i) => ({ path, sha256: sha256(bytes[i]) })),
      output: { path: outputPath, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Mega Minion card, projectile and sprite rules.");
