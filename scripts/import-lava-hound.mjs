import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/chr_lava_hound.bin",
  "reference/sc/chr_lava_hound_tex.png",
  "reference/sc/chr_lava_pups.bin",
  "reference/sc/chr_lava_pups_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const cards = csvRows(inputs[0].toString());
const units = csvRows(inputs[1].toString());
const projectiles = csvRows(inputs[2].toString());
const card = cards.find((row) => row.Name === "LavaHound");
const hound = units.find((row) => row.Name === "LavaHound");
const pup = units.find((row) => row.Name === "LavaPups");
const houndShot = projectiles.find((row) => row.Name === "LavaHoundProjectile");
const pupShot = projectiles.find((row) => row.Name === "LavaPupProjectile");
const model = parseSC(inputs[3]);
const childModel = parseSC(inputs[5]);
const portraits = parseSC(inputs[7]);
if (card?.ManaCost !== "7" || card.Rarity !== "Legendary" ||
    card.IconFile !== "lava_hound" || card.SummonCharacter !== "LavaHound" ||
    hound?.Hitpoints !== "3000" || hound.Speed !== "45" ||
    hound.TargetOnlyBuildings !== "true" || hound.DeathSpawnCharacter !== "LavaPups" ||
    hound.DeathSpawnCount !== "6" || hound.DeathSpawnRadius !== "2500" ||
    hound.DeathSpawnPushback !== "true" || hound.IgnorePushback !== "true" ||
    hound.Projectile !== "LavaHoundProjectile" ||
    pup?.Hitpoints !== "179" || pup.Speed !== "60" ||
    pup.Projectile !== "LavaPupProjectile" ||
    houndShot?.Damage !== "45" || pupShot?.Damage !== "45" ||
    houndShot.ExportName !== "particle_coal1" ||
    pupShot.ExportName !== "particle_coal1" ||
    !model.names.lava_hound_idle1_1 || !model.names.lava_hound_red_run1_9 ||
    !childModel.names.lava_pups_idle1_1 || !childModel.names.lava_pups_attack1_9 ||
    !portraits.names.lava_hound)
  throw new Error("Recheck archived Lava Hound, Lava Pups, projectile and artwork");
const unit = (row, projectile) => ({
  source: row.Name,
  sourceHitpoints: Number(row.Hitpoints),
  sourceDamage: Number(projectile.Damage),
  sourceSpeed: Number(row.Speed),
  sourceRange: Number(row.Range) / 1000,
  sourceHitSpeed: Number(row.HitSpeed) / 1000,
  sourceLoadTime: Number(row.LoadTime) / 1000,
  sourceDeployTime: Number(row.DeployTime) / 1000,
  targetsBuildings: row.TargetOnlyBuildings === "true",
  hitsAir: row.AttacksAir === "true",
  ignoresPushback: row.IgnorePushback === "true",
  flyingHeight: Number(row.FlyingHeight) / 1000,
  projectileStartZ: Number(row.ProjectileStartZ) / 1000,
  projectile: {
    source: projectile.Name,
    speed: Number(projectile.Speed) / 60,
    homing: projectile.Homing === "true",
    export: projectile.ExportName,
    trail: projectile.TrailEffect,
    hit: projectile.HitEffect,
  },
  blueExport: row.BlueExportName,
  redExport: row.RedExportName,
});
const outputPath = "src/game/lava-hound-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  hound: {
    ...unit(hound, houndShot),
    deathSpawn: {
      character: hound.DeathSpawnCharacter,
      count: Number(hound.DeathSpawnCount),
      radius: Number(hound.DeathSpawnRadius) / 1000,
      pushback: hound.DeathSpawnPushback === "true",
    },
  },
  pup: unit(pup, pupShot),
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/lava-hound-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Lava Hound and Lava Pups rules.");
