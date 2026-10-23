import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvGroups, csvRows } from "./lib/csv.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tables = {},
  files = [];
for (const [name, directory] of [
  ["effects", "client"],
  ["particle_emitters", "client"],
  ["characters", "logic"],
  ["buildings", "logic"],
  ["projectiles", "logic"],
  ["spells_other", "logic"],
  ["area_effect_objects", "logic"],
]) {
  const path = `reference/${directory}/${name}.csv`,
    bytes = await readFile(path);
  tables[name] =
    directory === "client"
      ? csvGroups(bytes.toString())
      : Object.fromEntries(
          csvRows(bytes.toString())
            .filter((r) => r.Name)
            .map((r) => [r.Name, r]),
        );
  files.push({ path, sha256: sha(bytes) });
}
const profilesPath = "src/game/combat-data.json",
  profilesBytes = await readFile(profilesPath);
const profiles = JSON.parse(profilesBytes);
files.push({ path: profilesPath, sha256: sha(profilesBytes) });
const cardsPath = "public/assets/ui/cards/cards.json",
  cardsBytes = await readFile(cardsPath),
  cards = JSON.parse(cardsBytes).portraits;
files.push({ path: cardsPath, sha256: sha(cardsBytes) });
const sources = { tower: "TowerExplode", king: "King_player_die" };
for (const [id, profile] of Object.entries(profiles)) {
  if (id.endsWith("-tower")) continue;
  sources[id] = (
    tables.characters[profile.source] ?? tables.buildings[profile.source]
  ).DeathEffect;
}
sources["skeleton-army"] = sources.skeletons;
const balloon = tables.characters[profiles.balloon.source];
sources["balloon-bomb"] =
  tables.buildings[balloon.DeathSpawnCharacter].DeathEffect;
const effects = {},
  impacts = {},
  launches = {},
  movements = {},
  landings = {},
  deployments = {},
  emitters = {};
// Same bounded source correction used by the audio importer: this particle
// branch's enemy replacement recurses back into itself through Giant Skeleton.
const ignoredEnemyVersions = [
  {
    effect: "Deploy_ground_fx_largeSize",
    enemyVersion: "giant_skeleton_deploy_enemy",
    reason:
      "Cyclic enemy substitution on a particle-only branch; preserve its own rows.",
  },
];
for (const entry of ignoredEnemyVersions)
  if (tables.effects[entry.effect]?.[0].EnemyVersion !== entry.enemyVersion)
    throw new Error(`Recheck historical effect correction: ${entry.effect}`);
function importEmitter(name) {
  if (emitters[name]) return emitters[name];
  const group = tables.particle_emitters[name];
  if (!group) throw new Error(`Unknown emitter ${name}`);
  const p = group[0];
  const pair = (min, max, divisor = 1) => [
    Number(p[min]) / divisor,
    Number(p[max]) / divisor,
  ];
  const clips = group
    .filter((r) =>
      ["sc/effects.sc", "sc/building_mega_bomb.sc"].includes(
        r.ParticleResource,
      ),
    )
    .map((r) => r.ParticleExportName);
  if (!clips.length)
    throw new Error(`Emitter ${name} has no supported native artwork`);
  return (emitters[name] = {
    count: Number(p.ParticleCount),
    emissionLife: pair("MinLife", "MaxLife", 1000),
    interval: pair("ParticleMinInterval", "ParticleMaxInterval", 1000),
    life: pair("ParticleMinLife", "ParticleMaxLife", 1000),
    angle: pair("ParticleMinAngle", "ParticleMaxAngle", 180 / Math.PI),
    radius: pair("ParticleMinRadius", "ParticleMaxRadius", 30),
    speed: pair("ParticleMinSpeed", "ParticleMaxSpeed", 30),
    height: Number(p.ParticleStartZ) / 30,
    verticalSpeed: pair("ParticleMinVelocityZ", "ParticleMaxVelocityZ", 30),
    // Native TailLength is an integer age offset, not a spatial distance.
    tailDelayMs: pair("ParticleMinTailLength", "ParticleMaxTailLength"),
    gravity: Number(p.ParticleGravity) / 30,
    startScale: p.StartScale ? Number(p.StartScale) / 100 : 1,
    endScale: p.EndScale ? Number(p.EndScale) / 100 : 1,
    fadeIn: Number(p.FadeInDuration) / 1000,
    fadeOut: Number(p.FadeOutDuration) / 1000,
    // Native Inertia subtracts source speed units per second, not a percentage.
    inertia: Number(p.Inertia) / 30,
    rotate: p.RotateToDirection.toLowerCase() === "true",
    loop: p.LoopParticleClip.toLowerCase() === "true",
    clips,
  });
}
function composition(name, team, delay = 0, scale = 1, ancestry = []) {
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
  if (ancestry.includes(name))
    throw new Error(`Cyclic effects: ${[...ancestry, name]}`);
  return rows.flatMap((row) => {
    const time = delay + Number(row.Time) / 1000;
    const size =
      (((scale * Number(row.Scale || 100)) / 100) *
        Number(row.RenderableScale || 100)) /
      100;
    if (row.Type === "Effect")
      return composition(row.Effect, team, time, size, [...ancestry, name]);
    if (row.Type !== "ParticleEmitter") return [];
    // Tower rubble persists from world state instead of occupying the transient pool.
    if (
      ["Tower_destroyed_ground", "KingTower_destroyed_ground"].includes(
        row.ParticleEmitterName,
      )
    )
      return [];
    const emitter = importEmitter(row.ParticleEmitterName);
    // Layer controls ordering, not flight. Deployment rocks start above the
    // ground with upward velocity and gravity; preserve that ballistic path.
    const ballistic =
      emitter.height > 0 &&
      emitter.gravity < 0 &&
      emitter.verticalSpeed.some((speed) => speed > 0);
    return [
      {
        emitter: row.ParticleEmitterName,
        delay: time,
        scale: size,
        layer: row.Layer || "Object",
        ground:
          row.Layer === "Shadow" ||
          (row.Layer === "Ground" && !ballistic) ||
          emitter.clips.some((c) => c.startsWith("death_ground_")),
      },
    ];
  });
}
for (const [id, source] of Object.entries(sources)) {
  effects[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
}
for (const [id, expected] of Object.entries({
  fireball: "Fireball_explosion",
  zap: "Spell_zap_effect",
  arrows: "ArrowHitGround",
})) {
  const card = cards[id];
  const spell = tables[card.table][card.row];
  const projectile =
    tables.projectiles[spell.CustomFirstProjectile || spell.Projectile];
  const source =
    projectile?.HitEffect ||
    tables.area_effect_objects[spell.AreaEffectObject]?.OneShotEffect;
  if (source !== expected)
    throw new Error(`Recheck native ${id} impact binding: ${source}`);
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
}
// These DamageEffect compositions contain authored impact layers at the
// attack target: Giant's punch dust, Balloon's crater and Tesla's beam sparks.
for (const [id, expected] of Object.entries({
  giant: "giant_hit",
  balloon: "balloon_hit",
  tesla: "tesla_hit_effect",
})) {
  const profile = profiles[id];
  const actor =
    tables.characters[profile.source] ?? tables.buildings[profile.source];
  if (actor.DamageEffect !== expected)
    throw new Error(
      `Recheck native ${id} damage impact: ${actor.DamageEffect}`,
    );
  impacts[`hit:${id}`] = {
    source: expected,
    components: composition(expected, "blue"),
    enemyComponents: composition(expected, "red"),
  };
}
const cannonLaunch = tables.buildings[profiles.cannon.source].ProjectileEffect;
if (cannonLaunch !== "cannon_fire_projectile")
  throw new Error(`Recheck native Cannon launch effect: ${cannonLaunch}`);
launches.cannon = {
  source: cannonLaunch,
  components: composition(cannonLaunch, "blue"),
  enemyComponents: composition(cannonLaunch, "red"),
};
for (const [id, expected] of Object.entries({
  knight: "knight_steps",
  prince: "prince_steps",
})) {
  const source = tables.characters[profiles[id].source].MoveEffect;
  if (source !== expected)
    throw new Error(`Recheck native ${id} movement effect: ${source}`);
  movements[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
}
const hogLanding =
  tables.characters[profiles["hog-rider"].source].LandingEffect;
if (hogLanding !== "hog_rider_landing")
  throw new Error(`Recheck native Hog Rider landing: ${hogLanding}`);
landings["hog-rider"] = {
  source: hogLanding,
  components: composition(hogLanding, "blue"),
  enemyComponents: composition(hogLanding, "red"),
};
for (const [id, expected] of Object.entries({
  musketeer: "cannon_hit",
  bomber: "BombTower_projectile_hit",
  "baby-dragon": "dragon_hit",
  wizard: "chr_wizard_projectile_hit",
  cannon: "cannon_hit",
})) {
  const profile = profiles[id];
  const actor =
    tables.characters[profile.source] ?? tables.buildings[profile.source];
  const source = tables.projectiles[actor.Projectile]?.HitEffect;
  if (source !== expected)
    throw new Error(`Recheck native ${id} attack impact binding: ${source}`);
  impacts[`hit:${id}`] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
}
for (const [id, profile] of Object.entries(profiles)) {
  if (id.endsWith("-tower")) continue;
  const source = (
    tables.characters[profile.source] ?? tables.buildings[profile.source]
  ).SpawnEffect;
  deployments[id] = {
    source,
    components: source ? composition(source, "blue") : [],
    enemyComponents: source ? composition(source, "red") : [],
  };
}
effects.tower.rubble = "Tower_destroyed_ground1";
effects.king.rubble = "Tower_destroyed_ground2";
const path = "src/render/destruction-data.json",
  bytes =
    JSON.stringify(
      {
        effects,
        impacts,
        launches,
        movements,
        landings,
        deployments,
        emitters,
      },
      null,
      2,
    ) + "\n";
await writeFile(path, bytes);
await writeFile(
  "reference/client/manifest.json",
  JSON.stringify(
    {
      source: "https://github.com/smlbiobot/cr",
      commit: "7fc7687e6de74690e902543ee4b59f562121e225",
      directory:
        "apk/1.8.0/com.supercell.clashroyale_1.8.0_unpack/assets/csv_client/",
      files,
      ignoredEnemyVersions,
      output: { path, sha256: sha(bytes) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Imported ${Object.keys(effects).length} death compositions, ${Object.keys(impacts).length} impact compositions, ${Object.keys(deployments).length} deployment compositions and ${Object.keys(emitters).length} emitters.`,
);
