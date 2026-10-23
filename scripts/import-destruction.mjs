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
  trails = {},
  launches = {},
  movements = {},
  charges = {},
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
      [
        "sc/effects.sc",
        "sc/building_mega_bomb.sc",
        "sc/chr_valkyrie.sc",
        "sc/chr_battle_ram.sc",
        "sc/chr_zap_machine.sc",
      ].includes(r.ParticleResource),
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
    // Some effect heads carry a sound but no emitter; children hold the particles.
    if (!row.ParticleEmitterName) return [];
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
  rocket: "Rocket_explosion",
  lightning: "Spell_lightning_effect",
  log: "log_hit",
  "goblin-barrel": "goblin_barrel_explosion",
})) {
  const card = cards[id];
  const spell = tables[card.table][card.row];
  const area = tables.area_effect_objects[spell.AreaEffectObject];
  const projectile =
    tables.projectiles[
      spell.CustomFirstProjectile || spell.Projectile || area?.Projectile
    ];
  const source = projectile?.HitEffect || area?.OneShotEffect;
  if (source !== expected)
    throw new Error(`Recheck native ${id} impact binding: ${source}`);
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
}
const rocketTrail = tables.projectiles.RocketSpell?.TrailEffect;
if (rocketTrail !== "Rocket_Emitter")
  throw new Error(`Recheck native Rocket trail binding: ${rocketTrail}`);
trails.rocket = {
  source: rocketTrail,
  components: composition(rocketTrail, "blue"),
  enemyComponents: composition(rocketTrail, "red"),
};
const rollingLog = tables.projectiles.LogProjectileRolling;
if (
  rollingLog?.DeathEffect !== "log_die" ||
  rollingLog.TrailEffect !== "log_emitter"
)
  throw new Error("Recheck native rolling Log effects");
impacts["log-die"] = {
  source: rollingLog.DeathEffect,
  components: composition(rollingLog.DeathEffect, "blue"),
  enemyComponents: composition(rollingLog.DeathEffect, "red"),
};
trails.log = {
  source: rollingLog.TrailEffect,
  components: composition(rollingLog.TrailEffect, "blue"),
  enemyComponents: composition(rollingLog.TrailEffect, "red"),
};
const dartTrail = tables.projectiles.BlowdartGoblinProjectile?.TrailEffect;
if (dartTrail !== "BlowdartProjectileEmitter")
  throw new Error(`Recheck native Dart Goblin trail: ${dartTrail}`);
trails["dart-goblin"] = {
  source: dartTrail,
  components: composition(dartTrail, "blue"),
  enemyComponents: composition(dartTrail, "red"),
};
const iceTrail = tables.projectiles.ice_wizardProjectile?.TrailEffect;
if (iceTrail !== "ice_wiz_emitter")
  throw new Error(`Recheck native Ice Wizard trail: ${iceTrail}`);
trails["ice-wizard"] = {
  source: iceTrail,
  components: composition(iceTrail, "blue"),
  enemyComponents: composition(iceTrail, "red"),
};
const princessTrail = tables.projectiles.PrincessProjectile?.TrailEffect;
if (princessTrail !== "PrincessArrowProjectileEmitter")
  throw new Error(`Recheck native Princess arrow trail: ${princessTrail}`);
trails.princess = {
  source: princessTrail,
  components: composition(princessTrail, "blue"),
  enemyComponents: composition(princessTrail, "red"),
};
const infernoHit = tables.characters.InfernoDragon?.DamageEffect;
if (infernoHit !== "inferno_hit_effect")
  throw new Error(`Recheck native Inferno Dragon hit: ${infernoHit}`);
impacts["hit:inferno-dragon"] = {
  source: infernoHit,
  components: composition(infernoHit, "blue"),
  enemyComponents: composition(infernoHit, "red"),
};
const electroHit = tables.characters.ElectroWizard?.DamageEffect;
if (electroHit !== "electro_wizard_hit")
  throw new Error(`Recheck native Electro Wizard hit: ${electroHit}`);
impacts["hit:electro-wizard"] = {
  source: electroHit,
  components: composition(electroHit, "blue"),
  enemyComponents: composition(electroHit, "red"),
};
const minerTravel = tables.characters.Miner?.SpawnPathfindEffect;
if (minerTravel !== "miner_travel_effect")
  throw new Error(`Recheck native Miner travel effect: ${minerTravel}`);
impacts["miner-travel"] = {
  source: minerTravel,
  components: composition(minerTravel, "blue"),
  enemyComponents: composition(minerTravel, "red"),
};
trails.miner = {
  source: minerTravel,
  components: composition(minerTravel, "blue"),
  enemyComponents: composition(minerTravel, "red"),
};
const boulder = tables.projectiles.BowlerProjectile;
if (boulder?.TrailEffect !== "bowler_projectile_trail" ||
    boulder.DeathEffect !== "bowler_projectile_die")
  throw new Error("Recheck native Bowler effects");
trails.bowler = {
  source: boulder.TrailEffect,
  components: composition(boulder.TrailEffect, "blue"),
  enemyComponents: composition(boulder.TrailEffect, "red"),
};
impacts["hit:bowler"] = {
  source: boulder.DeathEffect,
  components: composition(boulder.DeathEffect, "blue"),
  enemyComponents: composition(boulder.DeathEffect, "red"),
};
const axe = tables.projectiles.AxeManProjectile;
if (axe?.TrailEffect !== "AxeProjectileEmitter" ||
    axe.HitEffect !== "axe_man_projectile_hit" ||
    axe.PingpongDeathEffect !== "axe_man_projectile_die")
  throw new Error("Recheck native Executioner axe effects");
trails.executioner = {
  source: axe.TrailEffect,
  components: composition(axe.TrailEffect, "blue"),
  enemyComponents: composition(axe.TrailEffect, "red"),
};
impacts["hit:executioner"] = {
  source: axe.HitEffect,
  components: composition(axe.HitEffect, "blue"),
  enemyComponents: composition(axe.HitEffect, "red"),
};
impacts["axe-die"] = {
  source: axe.PingpongDeathEffect,
  components: composition(axe.PingpongDeathEffect, "blue"),
  enemyComponents: composition(axe.PingpongDeathEffect, "red"),
};
const zapMachine = tables.projectiles.ZapMachineProjectile;
if (zapMachine?.TrailEffect !== "zapMachine_trail_emitter" ||
    zapMachine.HitEffect !== "zapmachine_projectile_hit")
  throw new Error("Recheck native Sparky cannon effects");
trails.sparky = {
  source: zapMachine.TrailEffect,
  components: composition(zapMachine.TrailEffect, "blue"),
  enemyComponents: composition(zapMachine.TrailEffect, "red"),
};
impacts["hit:sparky"] = {
  source: zapMachine.HitEffect,
  components: composition(zapMachine.HitEffect, "blue"),
  enemyComponents: composition(zapMachine.HitEffect, "red"),
};
const rageBottle = tables.buildings.RageBarbarianBottle;
if (rageBottle?.DeathEffect !== "rage_bottle_explode" ||
    rageBottle.DeathAreaEffect !== "BarbarianRage")
  throw new Error("Recheck native Lumberjack death bottle");
impacts["bottle:lumberjack"] = {
  source: rageBottle.DeathEffect,
  components: composition(rageBottle.DeathEffect, "blue"),
  enemyComponents: composition(rageBottle.DeathEffect, "red"),
};
const darkPrince = tables.characters.DarkPrince;
if (darkPrince?.ShieldLostEffect !== "GuardShieldDown" ||
    darkPrince.ChargeEffect !== "dark_prince_charge")
  throw new Error("Recheck native Dark Prince effects");
impacts["shield:dark-prince"] = {
  source: darkPrince.ShieldLostEffect,
  components: composition(darkPrince.ShieldLostEffect, "blue"),
  enemyComponents: composition(darkPrince.ShieldLostEffect, "red"),
};
const battleRam = tables.characters.BattleRam;
if (battleRam?.TargetedHitEffect !== "battle_ram_hit" ||
    battleRam.ChargeEffect !== "battleram_charge" ||
    battleRam.DeathEffect !== "battle_ram_die")
  throw new Error("Recheck native Battle Ram effects");
impacts["hit:battle-ram"] = {
  source: battleRam.TargetedHitEffect,
  components: composition(battleRam.TargetedHitEffect, "blue"),
  enemyComponents: composition(battleRam.TargetedHitEffect, "red"),
};
const tornadoArea = tables.area_effect_objects.Tornado;
if (tornadoArea?.ScaledEffect !== "Spell_tornado_deploy")
  throw new Error("Recheck native Tornado visual binding");
impacts.tornado = {
  source: tornadoArea.ScaledEffect,
  components: composition(tornadoArea.ScaledEffect, "blue"),
  enemyComponents: composition(tornadoArea.ScaledEffect, "red"),
};
const graveyardArea = tables.area_effect_objects.Graveyard;
if (
  graveyardArea?.ScaledEffect !== "Spell_graveyard_ground" ||
  graveyardArea.SpawnEffect !== "Graveyard_appear"
)
  throw new Error("Recheck native Graveyard visual bindings");
for (const [id, source] of [
  ["graveyard", graveyardArea.ScaledEffect],
  ["graveyard-appear", graveyardArea.SpawnEffect],
])
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
const cloneArea = tables.area_effect_objects.Clone;
if (cloneArea?.ScaledEffect !== "spell_clone_ground")
  throw new Error("Recheck native Clone area visual binding");
impacts.clone = {
  source: cloneArea.ScaledEffect,
  components: composition(cloneArea.ScaledEffect, "blue"),
  enemyComponents: composition(cloneArea.ScaledEffect, "red"),
};
impacts["clone-appear"] = {
  source: "hologram_loop",
  components: composition("hologram_loop", "blue"),
  enemyComponents: composition("hologram_loop", "red"),
};
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
const princeCharge = tables.characters[profiles.prince.source].ChargeEffect;
if (princeCharge !== "prince_charge")
  throw new Error(`Recheck native Prince charge effect: ${princeCharge}`);
charges.prince = {
  source: princeCharge,
  components: composition(princeCharge, "blue"),
  enemyComponents: composition(princeCharge, "red"),
};
charges["dark-prince"] = {
  source: darkPrince.ChargeEffect,
  components: composition(darkPrince.ChargeEffect, "blue"),
  enemyComponents: composition(darkPrince.ChargeEffect, "red"),
};
movements["dark-prince"] = {
  source: darkPrince.MoveEffect,
  components: composition(darkPrince.MoveEffect, "blue"),
  enemyComponents: composition(darkPrince.MoveEffect, "red"),
};
charges["battle-ram"] = {
  source: battleRam.ChargeEffect,
  components: composition(battleRam.ChargeEffect, "blue"),
  enemyComponents: composition(battleRam.ChargeEffect, "red"),
};
movements["battle-ram"] = {
  source: battleRam.MoveEffect,
  components: composition(battleRam.MoveEffect, "blue"),
  enemyComponents: composition(battleRam.MoveEffect, "red"),
};
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
  "royal-giant": "royal_giant_projectile_hit",
  "mega-minion": "mega_minion_hit",
  "dart-goblin": "BlowdartArrowHit",
  "ice-wizard": "ice_wizard_hit",
  princess: "PrincessArrowHitGround",
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
const freezeCard = cards.freeze;
const freezeSpell = tables[freezeCard.table][freezeCard.row];
const freezeArea = tables.area_effect_objects[freezeSpell.AreaEffectObject];
if (
  freezeSpell.AreaEffectObject !== "Freeze" ||
  freezeArea.ScaledEffect !== "Spell_freeze_ground" ||
  freezeArea.LoopingEffect !== "Spell_freeze_loop"
)
  throw new Error("Recheck native Freeze area effect bindings");
for (const [id, source] of [
  ["freeze", freezeArea.ScaledEffect],
  ["freeze-loop", freezeArea.LoopingEffect],
])
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
const poisonCard = cards.poison;
const poisonSpell = tables[poisonCard.table][poisonCard.row];
const poisonArea = tables.area_effect_objects[poisonSpell.AreaEffectObject];
if (
  poisonSpell.AreaEffectObject !== "Poison" ||
  poisonArea.ScaledEffect !== "Spell_poison_ground" ||
  poisonArea.OneShotEffect !== "Spell_poison_effect" ||
  poisonArea.LoopingEffect !== "Spell_poison_loop"
)
  throw new Error("Recheck native Poison area effect bindings");
for (const [id, source] of [
  ["poison", poisonArea.OneShotEffect],
  ["poison-loop", poisonArea.LoopingEffect],
])
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
const rageCard = cards.rage;
const rageSpell = tables[rageCard.table][rageCard.row];
const rageArea = tables.area_effect_objects[rageSpell.AreaEffectObject];
if (
  rageSpell.AreaEffectObject !== "Rage" ||
  rageArea.ScaledEffect !== "Spell_rage_ground" ||
  rageArea.OneShotEffect !== "Spell_rage_effect" ||
  rageArea.LoopingEffect !== "Spell_rage_loop"
)
  throw new Error("Recheck native Rage area effect bindings");
for (const [id, source] of [
  ["rage", rageArea.OneShotEffect],
  ["rage-loop", rageArea.LoopingEffect],
])
  impacts[id] = {
    source,
    components: composition(source, "blue"),
    enemyComponents: composition(source, "red"),
  };
effects.tower.rubble = "Tower_destroyed_ground1";
effects.king.rubble = "Tower_destroyed_ground2";
const path = "src/render/destruction-data.json",
  bytes =
    JSON.stringify(
      {
        effects,
        impacts,
        trails,
        launches,
        movements,
        charges,
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
