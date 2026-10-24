// Preserve original building state labels and directional display lists.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSC } from "./lib/sc.mjs";
import { csvRows } from "./lib/csv.mjs";
const output = "public/assets/buildings";
await mkdir(output, { recursive: true });
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const neutral = [0, 0, 0, 255, 255, 255, 255];
const composeColor = (parent, child) => [
  ...[0, 1, 2].map((i) => Math.min(255, parent[i] + child[i])),
  (parent[3] * child[3]) / 255,
  ...[4, 5, 6].map((i) => (parent[i] * child[i]) / 255),
];
const round = (n) => Math.round(n * 100000) / 100000;
const buildingsPath = "reference/logic/buildings.csv";
const buildingTable = await readFile(buildingsPath);
const princessRow = csvRows(buildingTable.toString()).find(
  (row) => row.Name === "PrincessTower",
);
const bombTowerRow = csvRows(buildingTable.toString()).find(
  (row) => row.Name === "BombTower",
);

const manifest = {
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  version: "1.8.1",
  sourceTables: [{ path: buildingsPath, sha256: sha256(buildingTable) }],
  files: [],
};
for (const [id, name] of Object.entries({
  tesla: "building_tesla",
  cannon: "building_basic_cannon",
  mortar: "building_mortar",
  "bomb-tower": "building_bomb_tower",
  "inferno-tower": "building_inferno_tower",
  "x-bow": "building_xbow",
  "elixir-collector": "building_elixir_collector",
  "goblin-hut": "building_goblin_hut",
  tombstone: "building_tombstone",
  furnace: "building_firespirit_hut",
  king: "building_tower",
})) {
  const metadata = await readFile(`reference/sc/${name}.bin`),
    data = parseSC(metadata);
  const frames = [],
    frameLookup = new Map(),
    clips = {},
    usedShapes = new Set();
  function flatten(
    ref,
    frame,
    matrix = identity,
    color = neutral,
    depth = 0,
    overrides = {},
  ) {
    if (depth > 20) throw new Error(`Recursive SC display list ${name}`);
    if (data.shapes[ref]) {
      usedShapes.add(ref);
      return [
        { shape: ref, matrix: matrix.map(round), color: color.map(round) },
      ];
    }
    // The archived Goblin Hut references absent child 5 only in its first
    // frame. All later frames contain its complete four-part structure.
    if (id === "goblin-hut" && ref === 5) return [];
    const clip = data.clips[ref];
    if (!clip?.frames.length)
      throw new Error(`Missing SC child ${ref} in ${name}`);
    const sourceFrame = overrides[ref] ?? frame;
    return clip.frames[sourceFrame % clip.frames.length].flatMap((child) =>
      flatten(
        child.id,
        sourceFrame,
        multiply(matrix, data.matrices[child.matrix] ?? identity),
        composeColor(color, data.colors[child.color] ?? neutral),
        depth + 1,
        overrides,
      ),
    );
  }
  function saveFrame(parts) {
    const key = JSON.stringify(parts);
    let index = frameLookup.get(key);
    if (index === undefined) {
      index = frames.length;
      frames.push(parts);
      frameLookup.set(key, index);
    }
    return index;
  }
  const flattenChildren = (children, frame, overrides = {}) =>
    children.flatMap((child) =>
      flatten(
        child.id,
        frame,
        data.matrices[child.matrix] ?? identity,
        data.colors[child.color] ?? neutral,
        0,
        overrides,
      ),
    );

  const exports =
    id === "king"
      ? {
          blue: "KingTower_blue",
          red: "KingTower_red",
          "rubble-1": "Tower_destroyed_ground1",
          "rubble-2": "Tower_destroyed_ground2",
          "princess-blue": "StarTower_base_blue",
          "princess-red": "StarTower_base_red",
          "princess-blue-front": "StarTower_top_blue",
          "princess-red-front": "StarTower_top_red",
        }
      : id === "bomb-tower"
        ? {
            blue: "building_bomb_tower_blue",
            red: "building_bomb_tower_red",
            "blue-top": "building_bomb_tower_top_blue",
            "red-top": "building_bomb_tower_top_red",
          }
      : id === "mortar"
        ? Object.fromEntries(
            ["blue", "red"].flatMap((team) =>
              ["idle", "attack"].flatMap((state) =>
                Array.from({ length: 5 }, (_, i) => [
                  `${team}-${state}-${i + 1}`,
                  `building_mortar1${team === "red" ? "_enemy" : ""}_${state}1_${i + 1}`,
                ]),
              ),
            ),
          )
        : Object.fromEntries(
            Object.keys(data.names).map((name) => [
              /red|enemy/.test(name) ? "red" : "blue",
              name,
            ]),
          );
  for (const [team, exp] of Object.entries(exports)) {
    const ref = data.names[exp],
      clip = data.clips[ref];
    const turret =
      id === "king" && ["blue", "red"].includes(team)
        ? clip.frames[0].find((child) => data.clips[child.id]?.nf === 36)?.id
        : undefined;
    const sequence = clip.frames.map((_, i) =>
      saveFrame(
        flatten(
          ref,
          i,
          identity,
          neutral,
          0,
          turret === undefined ? {} : { [turret]: team === "blue" ? 0 : 35 },
        ),
      ),
    );
    clips[team] = {
      source: exp,
      fps: clip.fps,
      frames: sequence,
      labels: clip.labels,
    };
  }
  if (id === "king") {
    for (const team of ["blue", "red"]) {
      const exp = exports[team],
        root = data.clips[data.names[exp]],
        stopped = root.frames[root.labels.stop];
      const turretIndex = stopped.findIndex(
        (child) => data.clips[child.id]?.nf === 36,
      );
      if (turretIndex < 0)
        throw new Error(`Missing King cannon direction clip in ${exp}`);
      const turret = stopped[turretIndex],
        idle = root.frames[0];
      for (const [suffix, children] of Object.entries({
        sleep: idle,
        base: stopped.slice(0, turretIndex),
        turret: [turret],
        front: stopped.slice(turretIndex + 1),
      })) {
        if (!children.length) continue;
        const count = Math.max(
          1,
          ...children
            .filter((child) => suffix === "turret" || child.id !== turret.id)
            .map((child) => data.clips[child.id]?.nf ?? 1),
        );
        clips[`${team}-${suffix}`] = {
          source: `${exp}/${suffix}`,
          fps: root.fps,
          frames: Array.from({ length: count }, (_, frame) =>
            saveFrame(
              flattenChildren(
                children,
                frame,
                suffix === "turret"
                  ? {}
                  : { [turret.id]: team === "blue" ? 0 : 35 },
              ),
            ),
          ),
          labels: {},
        };
      }
    }
  }
  const bounds =
    id === "mortar" || id === "bomb-tower" || id === "inferno-tower" ||
    id === "x-bow" || id === "elixir-collector" || id === "goblin-hut" ||
    id === "tombstone" || id === "furnace"
      ? (() => {
          const b = [Infinity, Infinity, -Infinity, -Infinity];
          for (const parts of frames)
            for (const part of parts)
              for (const polygon of data.shapes[part.shape])
                for (const [x, y] of polygon.xy) {
                  const m = part.matrix;
                  const px = m[0] * x + m[2] * y + m[4];
                  const py = m[1] * x + m[3] * y + m[5];
                  b[0] = Math.min(b[0], px);
                  b[1] = Math.min(b[1], py);
                  b[2] = Math.max(b[2], px);
                  b[3] = Math.max(b[3], py);
                }
          if (!b.every(Number.isFinite))
            throw new Error(`Missing ${id} geometry`);
          return b.map(round);
        })()
      : JSON.parse(await readFile(`reference/sc/${id}-blue.json`, "utf8"))
          .bounds;
  const shapes = Object.fromEntries(
    [...usedShapes].map((ref) => [
      ref,
      data.shapes[ref].map((p) => ({
        sheet: p.sheet,
        xy: p.xy.map((p) => p.map(round)),
        uv: p.uv.map((p) => p.map(round)),
      })),
    ]),
  );
  const textures = [],
    hashes = [];
  for (let i = 0; i < data.textures.length; i++) {
    const filename = `${name}_tex${"_".repeat(i)}.png`;
    let original;
    try {
      original = await readFile(`/tmp/browser-royale-sprites/${filename}`);
    } catch {
      const response = await fetch(
        `https://raw.githubusercontent.com/smlbiobot/cr/${manifest.commit}/apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/${filename}`,
      );
      if (!response.ok)
        throw new Error(
          `Missing building texture ${filename}: ${response.status}`,
        );
      original = Buffer.from(await response.arrayBuffer());
    }
    const texture = await sharp(original)
        .webp({ lossless: true, effort: 6 })
        .toBuffer(),
      file = `${id}-${i}.webp`;
    await writeFile(`${output}/${file}`, texture);
    const info = await sharp(texture).metadata();
    textures.push({ file, width: info.width, height: info.height });
    hashes.push({
      file,
      sha256: sha256(texture),
      originalSha256: sha256(original),
    });
  }
  const json = JSON.stringify({
    version: 2,
    ...(id === "king"
      ? {
          attachedCharacterHeight:
            Number(princessRow.AttachedCharacterHeight) / 1000,
        }
      : id === "bomb-tower"
        ? {
            attachedCharacterHeight:
              Number(bombTowerRow.AttachedCharacterHeight) / 1000,
          }
        : {}),
    textures,
    bounds,
    anchor: [0, 0],
    shapes,
    clips,
    frames,
  });
  await writeFile(`${output}/${id}.json`, json);
  manifest.files.push({
    id,
    source: name,
    metadataSha256: sha256(metadata),
    dataSha256: sha256(json),
    textures: hashes,
    frames: frames.length,
  });
  console.log(
    id,
    Object.fromEntries(
      Object.entries(clips).map(([team, c]) => [
        team,
        { frames: c.frames.length, labels: c.labels },
      ]),
    ),
  );
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
