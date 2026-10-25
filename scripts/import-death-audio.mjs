import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvGroups, csvRows } from "./lib/csv.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tables = {},
  sources = [];
for (const [name, directory] of [
  ["effects", "client"],
  ["sounds", "client"],
  ["characters", "logic"],
  ["buildings", "logic"],
]) {
  const path = `reference/${directory}/${name}.csv`;
  const bytes = await readFile(path);
  sources.push({ path, sha256: hash(bytes) });
  tables[name] =
    directory === "client"
      ? csvGroups(bytes.toString())
      : Object.fromEntries(
          csvRows(bytes.toString())
            .filter((r) => r.Name)
            .map((r) => [r.Name, r]),
        );
}
const profilesPath = "src/game/combat-data.json";
const profilesBytes = await readFile(profilesPath);
sources.push({ path: profilesPath, sha256: hash(profilesBytes) });
const roots = { tower: "TowerExplode", king: "King_player_die" };
for (const [id, profile] of Object.entries(JSON.parse(profilesBytes))) {
  if (id === "king-tower" || id === "princess-tower") continue;
  roots[id] = (
    tables.characters[profile.source] ?? tables.buildings[profile.source]
  ).DeathEffect;
}
roots["skeleton-army"] = roots.skeletons;

const sounds = {};
function sound(name) {
  if (sounds[name]) return;
  const rows = tables.sounds[name];
  if (!rows || rows.length !== 1)
    throw new Error(`Unexpected death sound group: ${name}`);
  const row = rows[0];
  const pair = (min, max, divisor) => [
    Number(row[min]) / divisor,
    Number(row[max]) / divisor,
  ];
  const fileNames = row.FileNames
    ? row.FileNames.split(",").map((file) => file.trim())
    : [];
  if (fileNames.some((file) => !/^sfx\/[a-z0-9_]+\.wav$/i.test(file)))
    throw new Error(`Unexpected sound filename: ${row.FileNames}`);
  sounds[name] = {
    sourceFiles: fileNames,
    files: fileNames.map((file) => file.slice(4, -4)),
    volume: pair("MinVolume", "MaxVolume", 100),
    pitch: pair("MinPitch", "MaxPitch", 100),
    startDelay: pair("StartDelayMinMs", "StartDelayMaxMs", 1000),
    maximum: Number(row.MaximumByType),
    priority: Number(row.Priority),
    padding: Number(row.PadEmpyToEndMs) / 1000,
  };
}
function composition(name, team, delay = 0, ancestry = []) {
  let rows = tables.effects[name];
  if (!rows) throw new Error(`Unknown effect: ${name}`);
  if (team === "red" && rows[0].EnemyVersion) {
    name = rows[0].EnemyVersion;
    rows = tables.effects[name];
  }
  if (!rows || ancestry.includes(name))
    throw new Error(`Invalid nested effect: ${name}`);
  return rows.flatMap((row) => {
    const time = delay + Number(row.Time) / 1000;
    const cues = [];
    // Sound is independent of Type: an Effect or ParticleEmitter can also speak.
    if (row.Sound) {
      sound(row.Sound);
      cues.push({ sound: row.Sound, delay: time });
    }
    if (row.Type === "Effect" && row.Effect)
      cues.push(...composition(row.Effect, team, time, [...ancestry, name]));
    return cues;
  });
}
const effects = Object.fromEntries(
  Object.entries(roots).map(([id, source]) => [
    id,
    {
      source,
      components: composition(source, "blue"),
      enemyComponents: composition(source, "red"),
    },
  ]),
);
const commit = "b4530a1043b213ee2baf9c50a3d0d7fae22c2313";
const base = `https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/${commit}/`;
await mkdir("public/assets/audio", { recursive: true });
const audioFiles = [];
for (const name of [
  ...new Set(Object.values(sounds).flatMap((sound) => sound.files)),
].sort()) {
  const source = `sfx/${name}.ogg`,
    path = `public/assets/audio/${name}.ogg`;
  const response = await fetch(base + source);
  if (!response.ok) throw new Error(`${source}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString("ascii", 0, 4) !== "OggS")
    throw new Error(`Not an OGG stream: ${source}`);
  await writeFile(path, bytes);
  audioFiles.push({ path, source, bytes: bytes.length, sha256: hash(bytes) });
}
const path = "src/game/death-audio-data.json";
const bytes = JSON.stringify({ effects, sounds }, null, 2) + "\n";
await writeFile(path, bytes);
await writeFile(
  "reference/client/death-audio-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      sources,
      audioSource: "https://github.com/RoyaleAPI/cr-api-assets",
      audioCommit: commit,
      audioFiles,
      output: { path, sha256: hash(bytes) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(effects).length} death compositions, ${Object.keys(sounds).length} sound groups and ${audioFiles.length} OGG files.`,
);
