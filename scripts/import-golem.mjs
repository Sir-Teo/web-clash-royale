import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_golem.bin",
  "reference/sc/chr_golem_tex.png",
  "reference/sc/chr_golemite.bin",
  "reference/sc/chr_golemite_tex.png",
  "reference/sc/ui-spells.bin",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const cards = csvRows(inputs[0].toString());
const units = csvRows(inputs[1].toString());
const card = cards.find((row) => row.Name === "Golem");
const golem = units.find((row) => row.Name === "Golem");
const golemite = units.find((row) => row.Name === "Golemite");
const model = parseSC(inputs[2]);
const childModel = parseSC(inputs[4]);
const portraits = parseSC(inputs[6]);
if (card?.ManaCost !== "8" || card.Rarity !== "Epic" ||
    card.SummonCharacter !== "Golem" || card.IconFile !== "chr_golem" ||
    golem?.Hitpoints !== "3200" || golem.Damage !== "195" ||
    golem.DeployTime !== "3000" || golem.HitSpeed !== "2500" ||
    golem.Speed !== "45" || golem.TargetOnlyBuildings !== "true" ||
    golem.DeathDamage !== "195" || golem.DeathDamageRadius !== "2000" ||
    golem.DeathPushBack !== "1800" || golem.DeathSpawnCharacter !== "Golemite" ||
    golem.DeathSpawnCount !== "2" || golem.DeathSpawnRadius !== "1500" ||
    golem.DeathSpawnPushback !== "true" || golem.IgnorePushback !== "true" ||
    golemite?.Hitpoints !== "650" || golemite.Damage !== "40" ||
    golemite.DeathDamage !== "40" || golemite.DeathDamageRadius !== "2000" ||
    golemite.DeathPushBack !== "1800" ||
    golemite.TargetOnlyBuildings !== "true" ||
    !model.names.golem1_idle1_1 || !model.names.golem1_red_run1_9 ||
    !childModel.names.golemite_idle1_1 || !childModel.names.golemite_red_run1_9 ||
    !portraits.names.chr_golem)
  throw new Error("Recheck archived Golem, Golemite, explosion and model");
const unit = (row) => ({
  source: row.Name,
  sourceHitpoints: Number(row.Hitpoints),
  sourceDamage: Number(row.Damage),
  sourceSpeed: Number(row.Speed),
  sourceRange: Number(row.Range) / 1000,
  sourceHitSpeed: Number(row.HitSpeed) / 1000,
  sourceLoadTime: Number(row.LoadTime) / 1000,
  sourceDeployTime: Number(row.DeployTime) / 1000,
  targetsBuildings: row.TargetOnlyBuildings === "true",
  ignoresPushback: row.IgnorePushback === "true",
  death: {
    damage: Number(row.DeathDamage),
    radius: Number(row.DeathDamageRadius) / 1000,
    pushback: Number(row.DeathPushBack) / 1000,
    hitsAir: row.AttacksAir === "true",
  },
  blueExport: row.BlueExportName,
  redExport: row.RedExportName,
});
const outputPath = "src/game/golem-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  golem: {
    ...unit(golem),
    deathSpawn: {
      character: golem.DeathSpawnCharacter,
      count: Number(golem.DeathSpawnCount),
      radius: Number(golem.DeathSpawnRadius) / 1000,
      pushback: golem.DeathSpawnPushback === "true",
    },
  },
  golemite: unit(golemite),
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/golem-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Golem and Golemite rules.");
