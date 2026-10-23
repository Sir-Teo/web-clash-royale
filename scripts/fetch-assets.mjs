import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const commit = "b4530a1043b213ee2baf9c50a3d0d7fae22c2313";
const base = `https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/${commit}/`;
const cards = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini-pekka",
  "fireball",
  "arrows",
  "goblins",
  "spear-goblins",
  "skeletons",
  "skeleton-army",
  "bomber",
  "valkyrie",
  "hog-rider",
  "baby-dragon",
  "minions",
  "witch",
  "wizard",
  "prince",
  "pekka",
  "balloon",
  "cannon",
  "tesla",
  "zap",
  "freeze",
  "poison",
  "rage",
  "rocket",
  "lightning",
  "log",
  "tornado",
  "goblin-barrel",
  "graveyard",
  "clone",
  "mirror",
  "minion-horde",
  "three-musketeers",
  "goblin-gang",
  "barbarians",
  "royal-giant",
  "mega-minion",
  "dart-goblin",
  "ice-wizard",
  "princess",
  "inferno-dragon",
  "electro-wizard",
  "miner",
  "bowler",
  "dark-prince",
  "battle-ram",
  "executioner",
  "sparky",
];
const characters = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini_pekka",
  "goblins",
  "skeletons",
  "bomber",
  "valkyrie",
  "hog_rider",
  "baby_dragon",
  "minions",
  "witch",
  "wizard",
  "prince",
  "pekka",
  "balloon",
];
const sounds = [
  ...Array.from({ length: 10 }, (_, i) => `${i + 1}_cd_02`),
  "extratime_jingle_02",
  "big_horn_start_02_v2",
  "big_horn_end_02_v2",
  "button_click_02",
  "knight_deploy_31111",
  "giant_deploy_01",
  "skeleton_deploy_03",
  "fireball_hit_01",
  "zap_02",
  "arrow_hit_13",
  "win_tour_01",
  "lose_tour_01",
  "1st_crown_01",
  "gold_chest_open_01",
  "king_laughter_01",
  "bad_drop_03",
  "archer_attack_07",
  "clash_archer_deploy_01",
  "musketeer_deploy_01",
  "minipekka_deploy_01",
  "goblin_deploy_14",
  "valkyrie_deploy_02",
  "hogrider_deploy_01",
  "babydragon_deploy_01",
  "minion_deploy_01",
  "deploy_wizard_01",
  "prince_deploy_01",
  "pekka_deploy_01",
  "deploy_balloon_06",
  "axe_impact_01",
  "giant_attack_swing_01",
  "mini_pekka_hit_03",
  "baby_dragon_fireball_08",
];
const files = [
  ...cards.map((n) => [`cards/${n === "log" ? "the-log" : n}.png`, `cards/${n}.png`]),
  ...characters.map((n) => [`chr/${n}.png`, `characters/${n}.png`]),
  ...sounds.map((n) => [`sfx/${n}.ogg`, `audio/${n}.ogg`]),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [
    `arenas/arena${n}.png`,
    `arenas/arena${n}.png`,
  ]),
  ...["silver", "gold", "magical", "wooden"].map((n) => [
    `chests/chest-${n}.png`,
    `chests/${n}.png`,
  ]),
  ["music/2min_loop_battle_01.ogg", "audio/battle.ogg"],
];
const manifest = {
  source: "https://github.com/RoyaleAPI/cr-api-assets",
  commit,
  files: [],
};
for (let i = 0; i < files.length; i += 6)
  await Promise.all(
    files.slice(i, i + 6).map(async ([source, dest]) => {
      const r = await fetch(base + source);
      if (!r.ok) throw new Error(`${source}: ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      const path = `public/assets/${dest}`;
      await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await writeFile(path, b);
      manifest.files.push({
        path: dest,
        source,
        bytes: b.length,
        sha256: createHash("sha256").update(b).digest("hex"),
      });
    }),
  );
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(
  "public/assets/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Imported ${manifest.files.length} assets from ${commit}.`);
