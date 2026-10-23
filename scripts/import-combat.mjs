// Reproduce the small runtime combat table from pinned, decoded archival CSVs.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

function csv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return Object.fromEntries(
    rows
      .filter((r) => r[0] && r[0] !== "string")
      .map((r) => [
        r[0],
        Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
      ]),
  );
}
const tables = {},
  files = [];
for (const name of [
  "characters",
  "buildings",
  "projectiles",
  "spells_other",
  "globals",
]) {
  const path = `reference/logic/${name}.csv`,
    bytes = await readFile(path);
  tables[name] = csv(bytes.toString());
  files.push({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const names = {
  knight: "Knight",
  archers: "Archer",
  giant: "Giant",
  musketeer: "Musketeer",
  "three-musketeers": "Musketeer",
  "mini-pekka": "MiniPekka",
  goblins: "Goblin",
  "goblin-gang": "Goblin",
  barbarians: "Barbarian",
  "elite-barbarians": "AngryBarbarian",
  "royal-giant": "RoyalGiant",
  "mega-minion": "MegaMinion",
  "dart-goblin": "BlowdartGoblin",
  "ice-wizard": "IceWizard",
  princess: "Princess",
  "inferno-dragon": "InfernoDragon",
  "electro-wizard": "ElectroWizard",
  miner: "Miner",
  bowler: "Bowler",
  "dark-prince": "DarkPrince",
  "battle-ram": "BattleRam",
  executioner: "AxeMan",
  sparky: "ZapMachine",
  lumberjack: "RageBarbarian",
  "spear-goblins": "SpearGoblin",
  skeletons: "Skeleton",
  "skeleton-army": "Skeleton",
  bomber: "Bomber",
  valkyrie: "Valkyrie",
  "hog-rider": "HogRider",
  "baby-dragon": "BabyDragon",
  minions: "Minion",
  "minion-horde": "Minion",
  bats: "Bat",
  "night-witch": "DarkWitch",
  bandit: "Assassin",
  golem: "Golem",
  golemite: "Golemite",
  "lava-hound": "LavaHound",
  "lava-pup": "LavaPups",
  witch: "Witch",
  wizard: "Wizard",
  prince: "Prince",
  pekka: "Pekka",
  balloon: "Balloon",
  cannon: "Cannon",
  tesla: "Tesla",
  "king-tower": "KingTower",
  "princess-tower": "PrincessTower",
};
const data = {};
for (const [id, name] of Object.entries(names)) {
  const row = tables.characters[name] ?? tables.buildings[name];
  if (!row) throw new Error(`Missing combat row ${name}`);
  const p = tables.projectiles[row.Projectile];
  data[id] = {
    source: name,
    // LoadTime is interpreted as the portion already loaded before an attack.
    windup: Math.max(0, (Number(row.HitSpeed) - Number(row.LoadTime)) / 1000),
    sight: Number(row.SightRange) / 1000,
    ignoresKnockback: row.IgnorePushback.toLowerCase() === "true",
    projectile: p
      ? {
          source: row.Projectile,
          speed: Number(p.Speed) / 60,
          homing: p.Homing.toLowerCase() === "true",
          gravity: Number(p.Gravity),
        }
      : null,
  };
}
await writeFile(
  "src/game/combat-data.json",
  JSON.stringify(data, null, 2) + "\n",
);
await writeFile(
  "src/game/combat-settings.json",
  JSON.stringify(
    {
      kingActivationSeconds:
        Number(tables.globals.KING_ACTIVATE_TIME_MS.NumberValue) / 1000,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "reference/logic/manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      directory:
        "apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/csv_logic/",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(data).length} combat profiles from pinned archival tables.`,
);
