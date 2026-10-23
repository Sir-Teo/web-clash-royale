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
  ["projectiles", "logic"],
  ["spells_characters", "logic"],
  ["spells_buildings", "logic"],
  ["spells_other", "logic"],
  ["area_effect_objects", "logic"],
]) {
  const path = `reference/${directory}/${name}.csv`,
    bytes = await readFile(path);
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
const profilesPath = "src/game/combat-data.json",
  profilesBytes = await readFile(profilesPath);
sources.push({ path: profilesPath, sha256: hash(profilesBytes) });
const cardBindingsPath = "public/assets/ui/cards/cards.json",
  cardBindingsBytes = await readFile(cardBindingsPath),
  cardBindings = JSON.parse(cardBindingsBytes).portraits;
sources.push({ path: cardBindingsPath, sha256: hash(cardBindingsBytes) });
const sounds = {};
// This archived particle-only branch points back into a deployment tree,
// creating a cycle and introducing an unrelated Giant Skeleton voice.
const ignoredEnemyVersions = [
  {
    effect: "Deploy_ground_fx_largeSize",
    enemyVersion: "giant_skeleton_deploy_enemy",
    reason:
      "Cyclic enemy substitution on a particle-only branch; preserve its own rows.",
  },
];
for (const override of ignoredEnemyVersions)
  if (
    tables.effects[override.effect]?.[0].EnemyVersion !== override.enemyVersion
  )
    throw new Error(`Recheck historical effect correction: ${override.effect}`);
function sound(name) {
  if (sounds[name]) return;
  const rows = tables.sounds[name];
  if (!rows) throw new Error(`Unknown sound group ${name}`);
  // Keep row order and duplicates: each row is a separately authored variant.
  sounds[name] = rows.map((row) => {
    for (const key of [
      "Loop",
      "PlayVariationsInSequence",
      "PlayVariationsInSequenceManualReset",
    ])
      if (row[key] && row[key].toLowerCase() !== "false")
        throw new Error(`Unsupported ${key} in ${name}`);
    const pair = (min, max, divisor) => [
      Number(row[min]) / divisor,
      Number(row[max]) / divisor,
    ];
    const sourceFile = row.FileNames;
    if (sourceFile && !/^sfx\/[a-z0-9_]+\.wav$/i.test(sourceFile))
      throw new Error(`Unexpected filename ${sourceFile}`);
    return {
      sourceFile,
      file: sourceFile ? sourceFile.slice(4, -4) : null,
      volume: pair("MinVolume", "MaxVolume", 100),
      pitch: pair("MinPitch", "MaxPitch", 100),
      startDelay: pair("StartDelayMinMs", "StartDelayMaxMs", 1000),
      maximum: Number(row.MaximumByType),
      repeat: Number(row.MaxRepeatMs) / 1000,
      priority: Number(row.Priority),
      padding: Number(row.PadEmpyToEndMs) / 1000,
    };
  });
}
function composition(name, team, delay = 0, ancestry = []) {
  if (name.startsWith("sound:")) {
    const group = name.slice(6);
    sound(group);
    return [{ sound: group, delay }];
  }
  let rows = tables.effects[name];
  if (!rows) throw new Error(`Unknown effect ${name}`);
  if (
    team === "red" &&
    rows[0].EnemyVersion &&
    !ignoredEnemyVersions.some((entry) => entry.effect === name)
  ) {
    name = rows[0].EnemyVersion;
    rows = tables.effects[name];
  }
  if (!rows || ancestry.includes(name))
    throw new Error(`Invalid effect tree ${name}`);
  return rows.flatMap((row) => {
    const time = delay + Number(row.Time) / 1000,
      cues = [];
    if (row.Sound) {
      sound(row.Sound);
      cues.push({ sound: row.Sound, delay: time });
    }
    if (row.Type === "Effect" && row.Effect)
      cues.push(...composition(row.Effect, team, time, [...ancestry, name]));
    return cues;
  });
}
const profiles = {};
function phases(source, roots) {
  return {
    source,
    ...Object.fromEntries(
      Object.entries(roots).map(([phase, names]) => {
        const sources = names.filter(Boolean);
        return [
          phase,
          {
            sources,
            components: sources.flatMap((name) => composition(name, "blue")),
            enemyComponents: sources.flatMap((name) =>
              composition(name, "red"),
            ),
          },
        ];
      }),
    ),
  };
}
for (const [id, profile] of Object.entries(JSON.parse(profilesBytes))) {
  const row =
    tables.characters[profile.source] ?? tables.buildings[profile.source];
  const projectile = profile.projectile
    ? tables.projectiles[profile.projectile.source]
    : null;
  const binding = cardBindings[id],
    card = binding ? tables[binding.table][binding.row] : null;
  const deathSpawn =
    tables.characters[row.DeathSpawnCharacter] ??
    tables.buildings[row.DeathSpawnCharacter];
  if (binding && !card) throw new Error(`Unknown card source ${id}`);
  profiles[id] = phases(profile.source, {
    attack: [row.AttackStartEffect],
    charge: [row.ChargeEffect],
    launch: [row.ProjectileEffect],
    impact: [row.DamageEffect, projectile?.HitEffect],
    "impact-special": [row.DamageEffectSpecial],
    cast: [card?.CastSound && `sound:${card.CastSound}`, card?.Effect],
    spawn: [row.SpawnEffect],
    summon: [row.SpawnCharacterEffect],
    appear: [row.AppearEffect],
    hide: [row.HideEffect],
    "death-impact": [deathSpawn?.DeathEffect],
    "death-spawn": [deathSpawn?.SpawnEffect],
  });
  if (binding)
    profiles[id].cardSource = { table: binding.table, row: binding.row };
}
for (const [id, { table, row: name }] of Object.entries(cardBindings)) {
  if (table !== "spells_other") continue;
  const row = tables.spells_other[name];
  const projectile =
    tables.projectiles[row.CustomFirstProjectile || row.Projectile];
  const area = tables.area_effect_objects[row.AreaEffectObject];
  profiles[id] = phases(name, {
    attack: [],
    charge: [],
    launch: [],
    impact: [projectile?.HitEffect, area?.OneShotEffect],
    "impact-special": [],
    cast: [row.CastSound && `sound:${row.CastSound}`, row.Effect],
    spawn: [],
    summon: [],
    appear: [],
    hide: [],
    "death-impact": [],
    "death-spawn": [],
  });
  profiles[id].cardSource = { table, row: name };
}
const commit = "b4530a1043b213ee2baf9c50a3d0d7fae22c2313";
const base = `https://raw.githubusercontent.com/RoyaleAPI/cr-api-assets/${commit}/`;
const names = [
  ...new Set(
    Object.values(sounds).flatMap((variants) =>
      variants.map((v) => v.file).filter(Boolean),
    ),
  ),
].sort();
await mkdir("public/assets/audio", { recursive: true });
const audioFiles = [];
// Bounded downloads keep the import reproducible without flooding the asset host.
for (let offset = 0; offset < names.length; offset += 4) {
  audioFiles.push(
    ...(await Promise.all(
      names.slice(offset, offset + 4).map(async (name) => {
        const source = `sfx/${name}.ogg`,
          path = `public/assets/audio/${name}.ogg`;
        const response = await fetch(base + source);
        if (!response.ok) throw new Error(`${source}: ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.toString("ascii", 0, 4) !== "OggS")
          throw new Error(`Not an OGG file: ${source}`);
        await writeFile(path, bytes);
        return { path, source, bytes: bytes.length, sha256: hash(bytes) };
      }),
    )),
  );
}
const path = "src/game/combat-audio-data.json",
  bytes = JSON.stringify({ profiles, sounds }, null, 2) + "\n";
await writeFile(path, bytes);
await writeFile(
  "reference/client/combat-audio-manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      sources,
      ignoredEnemyVersions,
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
  `Imported ${Object.keys(profiles).length} combat profiles, ${Object.keys(sounds).length} sound groups and ${audioFiles.length} OGG files.`,
);
