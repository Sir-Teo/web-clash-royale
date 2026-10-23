// Reconstruct native card layers and unframed portraits from the pinned archive.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";
const output = "public/assets/ui/cards";
await mkdir(output, { recursive: true });
const data = parseSC(await readFile("reference/sc/ui.bin"));
const sourceManifest = JSON.parse(
  await readFile("public/assets/ui/manifest.json", "utf8"),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
let texture;
try {
  texture = await readFile("/tmp/royale-native-ui-texture.png");
} catch {
  const r = await fetch(
    `https://raw.githubusercontent.com/smlbiobot/cr/${sourceManifest.commit}/apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/sc/ui_tex.png`,
  );
  if (!r.ok) throw new Error(`UI atlas: ${r.status}`);
  texture = Buffer.from(await r.arrayBuffer());
}
if (
  hash(texture) !==
  sourceManifest.sources.find((s) => s.source === "sc/ui_tex.png").sha256
)
  throw new Error("Native UI texture hash mismatch");
const identity = [1, 0, 0, 1, 0, 0],
  neutral = [0, 0, 0, 255, 255, 255, 255];
const round = (n) => Math.round(n * 100000) / 100000;
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const tint = (a, b) => [
  ...[0, 1, 2].map((i) => Math.min(255, a[i] + b[i])),
  (a[3] * b[3]) / 255,
  ...[4, 5, 6].map((i) => (a[i] * b[i]) / 255),
];
const texts = {},
  usedShapes = new Set(),
  translations = {
    "elixar_count/count": "3",
    "card/elixar_count/count": "3",
    card_name: "Knight",
    card_level: "Level 11",
    count: "3",
  };
let state = 0;
const hidden = new Set([
  "frame_legendary",
  "selected",
  "selected_in_use",
  "selected_no_info",
  "card_info_bg",
  "rarity_glow",
  "progress",
  "lock",
  "material_count",
  "card_level_small",
  "new_tag",
]);
function flatten(
  id,
  frame,
  path = "",
  matrix = identity,
  color = neutral,
  depth = 0,
) {
  if (depth > 20) throw new Error("Recursive card display list");
  const binding = path.split("/").at(-1);
  if (hidden.has(binding)) return [];
  if (binding === "card_image")
    return [
      {
        shape: -1,
        binding: path,
        matrix: multiply(matrix, [0.5, 0, 0, 0.5, 0, 0]).map(round),
        color: color.map(round),
      },
    ];
  if (data.texts[id]) {
    texts[id] = data.texts[id];
    translations[path] ??= "";
    return [
      {
        text: id,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  }
  if (data.shapes[id]) {
    usedShapes.add(id);
    return [
      {
        shape: id,
        binding: path,
        matrix: matrix.map(round),
        color: color.map(round),
      },
    ];
  }
  const c = data.clips[id];
  if (!c?.frames.length) throw new Error(`Missing card child ${id}`);
  return c.frames[id === frameId ? state : frame % c.frames.length].flatMap(
    (child) => {
      const name = c.children[child.child]?.name;
      return flatten(
        child.id,
        frame,
        [path, name].filter(Boolean).join("/"),
        multiply(matrix, data.matrices[child.matrix] ?? identity),
        tint(color, data.colors[child.color] ?? neutral),
        depth + 1,
      );
    },
  );
}
const ingame = data.clips[data.names.spell_card_ingame];
const frameId = ingame.children.find((c) => c.name === "frame").id;
const pulseId = data.clips[frameId].children.find(
  (c) => data.clips[c.id].frames.length > 1,
).id;
const costId = ingame.children.find((c) => c.name === "elixar_count").id;
const exports = {
  hand: { id: data.names.spell_card_ingame, state: 0 },
  "hand-selected": { id: data.names.spell_card_ingame, state: 1 },
  deck: { id: data.names.spell_card_full, state: 0 },
  "deck-selected": { id: data.names.spell_card_full, state: 1 },
  reveal: { id: data.names.spell_card_ingame_reveal, state: 0 },
  "frame-pulse": { id: pulseId, state: 0 },
  cost: { id: costId, state: 0 },
};
const clips = {};
for (const [name, source] of Object.entries(exports)) {
  state = source.state;
  const clip = data.clips[source.id];
  clips[name] = {
    sourceId: source.id,
    frameState: state,
    fps: clip.fps,
    labels: clip.labels,
    frames: clip.frames.map((_, frame) => flatten(source.id, frame)),
  };
}
const shapes = {},
  files = [];
const [sheetWidth, sheetHeight] = data.textures[0];
for (const id of usedShapes) {
  const polygons = [];
  for (const [index, p] of data.shapes[id].entries()) {
    if (p.sheet !== 0) throw new Error(`Unexpected card atlas ${p.sheet}`);
    const u = p.uv.map((v) => v[0] * sheetWidth),
      v = p.uv.map((v) => v[1] * sheetHeight);
    if (new Set(p.uv.map((v) => v.join(","))).size === 1) {
      const pixel = await sharp(texture)
        .ensureAlpha()
        .extract({
          left: Math.floor(u[0]),
          top: Math.floor(v[0]),
          width: 1,
          height: 1,
        })
        .raw()
        .toBuffer();
      polygons.push({
        xy: p.xy,
        uv: p.uv,
        solid:
          ((pixel[3] << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]) >>>
          0,
      });
      continue;
    }
    const left = Math.floor(Math.min(...u)),
      top = Math.floor(Math.min(...v));
    const width = Math.min(sheetWidth - left, Math.ceil(Math.max(...u)) - left),
      height = Math.min(sheetHeight - top, Math.ceil(Math.max(...v)) - top);
    const file = `shape-${id}-${index}.webp`;
    const image = await sharp(texture)
      .extract({ left, top, width, height })
      .webp({ lossless: true })
      .toBuffer();
    await writeFile(`${output}/${file}`, image);
    files.push({ file, bytes: image.length, sha256: hash(image) });
    polygons.push({
      file,
      width,
      height,
      xy: p.xy,
      uv: p.uv.map(([x, y]) => [
        round(x * sheetWidth - left),
        round(y * sheetHeight - top),
      ]),
    });
  }
  shapes[id] = { polygons };
}
const portraitSource = parseSC(await readFile("reference/sc/ui-spells.bin"));
const tables = {},
  addedSources = [];
for (const name of ["spells_characters", "spells_buildings", "spells_other"]) {
  const path = `reference/logic/${name}.csv`,
    bytes = await readFile(path);
  tables[name] = Object.fromEntries(
    csvRows(bytes.toString()).map((r) => [r.Name, r]),
  );
  addedSources.push({
    source: `csv_logic/${name}.decoded.csv`,
    path,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
const spellBytes = await readFile("reference/sc/ui-spells.bin");
addedSources.push({
  source: "sc/ui_spells",
  path: "reference/sc/ui-spells.bin",
  bytes: spellBytes.length,
  sha256: hash(spellBytes),
});
const portraitNames = {
  knight: "Knight",
  archers: "Archer",
  giant: "Giant",
  musketeer: "Musketeer",
  "mini-pekka": "MiniPekka",
  fireball: "Fireball",
  arrows: "Arrows",
  goblins: "Goblins",
  "spear-goblins": "SpearGoblins",
  skeletons: "Skeletons",
  "skeleton-army": "SkeletonArmy",
  bomber: "Bomber",
  valkyrie: "Valkyrie",
  "hog-rider": "HogRider",
  "baby-dragon": "BabyDragon",
  minions: "Minions",
  witch: "Witch",
  wizard: "Wizard",
  prince: "Prince",
  pekka: "Pekka",
  balloon: "Balloon",
  cannon: "Cannon",
  tesla: "Tesla",
  zap: "Zap",
  freeze: "Freeze",
  poison: "Poison",
  rage: "Rage",
  rocket: "Rocket",
  lightning: "Lightning",
  log: "Log",
  tornado: "Tornado",
  "goblin-barrel": "GoblinBarrel",
  graveyard: "Graveyard",
  clone: "Clone",
  mirror: "Mirror",
  "minion-horde": "MinionHorde",
  bats: "Bats",
  "night-witch": "DarkWitch",
  bandit: "Assassin",
  golem: "Golem",
  "lava-hound": "LavaHound",
  "three-musketeers": "ThreeMusketeers",
  "goblin-gang": "GoblinGang",
  barbarians: "Barbarians",
  "elite-barbarians": "AngryBarbarians",
  "ice-spirit": "IceSpirits",
  "fire-spirits": "FireSpirits",
  "giant-skeleton": "GiantSkeleton",
  "ice-golem": "IceGolemite",
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
};
const sheets = [];
for (const [name, cache, expected] of [
  [
    "ui_spells_tex.png",
    "/tmp/royale-native-portraits.png",
    "1edfc08e407938b29749b5022b7fca13961836c7afca9361bc03c9d82f7b3410",
  ],
  [
    "ui_spells_tex_.png",
    "/tmp/royale-native-portraits-extra.png",
    "6822a7314b8e904aa88a47d04391cd0989094c86a6649ad719a458bc00528479",
  ],
]) {
  let bytes;
  try {
    bytes = await readFile(cache);
  } catch {
    const r = await fetch(
      `https://raw.githubusercontent.com/smlbiobot/cr/${sourceManifest.commit}/apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/sc/${name}`,
    );
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  if (hash(bytes) !== expected)
    throw new Error(`Portrait atlas hash mismatch: ${name}`);
  sheets.push(bytes);
  addedSources.push({
    source: `sc/${name}`,
    bytes: bytes.length,
    sha256: expected,
  });
}
const portraits = {};
for (const [id, rowName] of Object.entries(portraitNames)) {
  const table = Object.keys(tables).find((t) => tables[t][rowName]);
  const name = tables[table][rowName].IconFile,
    sourceId = portraitSource.names[name];
  const clip = portraitSource.clips[sourceId];
  if (clip.frames.length !== 1 || clip.frames[0].length !== 1)
    throw new Error(`Unexpected portrait ${id}`);
  const ref = clip.frames[0][0],
    shape = portraitSource.shapes[ref.id];
  if (shape.length !== 1 || ref.matrix !== 65535 || ref.color !== 65535)
    throw new Error(`Unexpected portrait geometry ${id}`);
  const p = shape[0],
    [w, h] = portraitSource.textures[p.sheet];
  const u = p.uv.map((v) => v[0] * w),
    v = p.uv.map((v) => v[1] * h);
  const left = Math.floor(Math.min(...u)),
    top = Math.floor(Math.min(...v));
  const width = Math.min(w - left, Math.ceil(Math.max(...u)) - left),
    height = Math.min(h - top, Math.ceil(Math.max(...v)) - top);
  const file = `portrait-${id}.webp`,
    image = await sharp(sheets[p.sheet])
      .extract({ left, top, width, height })
      .webp({ lossless: true })
      .toBuffer();
  await writeFile(`${output}/${file}`, image);
  files.push({ file, bytes: image.length, sha256: hash(image) });
  const key = 10000 + ref.id;
  shapes[key] = {
    polygons: [
      {
        file,
        width,
        height,
        xy: p.xy,
        uv: p.uv.map(([x, y]) => [round(x * w - left), round(y * h - top)]),
      },
    ],
  };
  portraits[id] = { shape: key, sourceId, name, table, row: rowName };
}
const json = JSON.stringify({
  clips,
  texts,
  shapes,
  portraits,
  translations,
  audio: {},
});
await writeFile(`${output}/cards.json`, json);
files.push({
  file: "cards.json",
  bytes: Buffer.byteLength(json),
  sha256: hash(json),
});
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      source: sourceManifest.source,
      commit: sourceManifest.commit,
      sources: [
        ...sourceManifest.sources.filter(
          (s) => s.source !== "csv_client/sounds.decoded.csv",
        ),
        ...addedSources,
      ],
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(clips).length} card clips, ${Object.keys(texts).length} text styles, ${usedShapes.size} shapes, ${Object.keys(portraits).length} unframed portraits.`,
);
