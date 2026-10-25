import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_other.csv",
  "reference/logic/projectiles.csv",
  "reference/sc/spell_goblin_barrel.bin",
];
const bytes = await Promise.all(paths.map((path) => readFile(path)));
const [spells, projectiles] = bytes
  .slice(0, 2)
  .map((input) => csvRows(input.toString()));
const spell = spells.find((row) => row.Name === "GoblinBarrel");
const projectile = projectiles.find((row) => row.Name === spell?.Projectile);
const art = parseSC(bytes[2]);
if (
  !spell ||
  !projectile ||
  spell.IconFile !== "goblin_barrel" ||
  spell.Rarity !== "Epic" ||
  spell.ManaCost !== "3" ||
  spell.OnlyEnemies !== "true" ||
  spell.Effect !== "goblin_barrel_spawn" ||
  spell.CastSound !== "sound_goblin_barrel_spawn" ||
  projectile.Name !== "GoblinBarrelSpell" ||
  projectile.Speed !== "400" ||
  projectile.FileName !== "sc/spell_goblin_barrel.sc" ||
  projectile.ExportName !== "spell_goblin_barrel_projectile" ||
  projectile.ShadowExportName !== "Barrel_shadow" ||
  projectile.HitEffect !== "goblin_barrel_explosion" ||
  projectile.Radius !== "1500" ||
  projectile.Gravity !== "40" ||
  projectile.SpawnCharacter !== "Goblin" ||
  projectile.SpawnCharacterCount !== "3" ||
  projectile.SpawnCharacterDeployTime !== "1200" ||
  projectile.SpawnCharacterLevelIndex !== "5" ||
  projectile.AoeToGround !== "true" ||
  projectile.OnlyEnemies !== "true" ||
  art.names[projectile.ExportName] === undefined ||
  art.names[projectile.ShadowExportName] === undefined
)
  throw new Error(
    "Recheck archived Goblin Barrel spell, projectile and artwork",
  );

const source = {
  card: spell.Name,
  projectile: projectile.Name,
  cost: Number(spell.ManaCost),
  rarity: spell.Rarity,
  speed: Number(projectile.Speed) / 60,
  gravity: Number(projectile.Gravity),
  landingRadius: Number(projectile.Radius) / 1000,
  spawnCard: "goblins",
  spawnCount: Number(projectile.SpawnCharacterCount),
  spawnDeployTime: Number(projectile.SpawnCharacterDeployTime) / 1000,
  spawnLevelIndex: Number(projectile.SpawnCharacterLevelIndex),
  visual: {
    projectile: projectile.ExportName,
    shadow: projectile.ShadowExportName,
    hit: projectile.HitEffect,
  },
};
const path = "src/game/goblin-barrel-data.json";
const output = Buffer.from(JSON.stringify(source, null, 2) + "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path, output);
await writeFile(
  "reference/client/goblin-barrel-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      inputs: paths.map((inputPath, i) => ({
        path: inputPath,
        sha256: sha256(bytes[i]),
      })),
      output: { path, sha256: sha256(output) },
    },
    null,
    2,
  ) + "\n",
);
console.log("Imported archived Goblin Barrel spell and spawn rules.");
