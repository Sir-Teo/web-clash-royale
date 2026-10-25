import { aiBodyValue } from "./ai-body-value";
import { CARD_MAP } from "./cards";
import { combatTraits, HEAL_PER_TICK } from "./combat";
import { clonePosition } from "./deployment";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import heal from "./heal-data.json" with { type: "json" };
import clone from "./clone-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import bowler from "./bowler-data.json" with { type: "json" };
import {
  hiddenSpellTarget,
  spellCandidatePoints,
  spellContains,
  type SpellTarget,
} from "./spell-targeting";

const ticks = (duration: number, elapsed = 0) =>
  Math.max(0, Math.floor((duration + elapsed + 1e-8) / heal.healInterval));
const hits = (attacker: Entity, target: Entity) =>
  (attacker.kind === "tower" ||
    !CARD_MAP[attacker.card as keyof typeof CARD_MAP].buildingsOnly ||
    target.kind !== "troop") &&
  (!target.air ||
    attacker.kind === "tower" ||
    !!CARD_MAP[attacker.card as keyof typeof CARD_MAP].hitsAir);
const close = (a: Entity, b: Entity, extra = 0) =>
  spellContains(a, b, a.range + b.radius + a.radius * 0.35 + extra);

// A hit can remove a shield or damage the body, never both. Current fixed
// destinations are used; homing shots retain their original entity target.
function incomingBodyDamage(
  entity: Entity,
  point: Point,
  horizon: number,
  projectiles: readonly Projectile[],
): number {
  let shield = entity.shield ?? 0,
    damage = 0;
  const incoming = projectiles
    .filter(
      (p) =>
        p.team !== entity.team &&
        p.damage > 0 &&
        (p.air || !entity.air) &&
        p.remaining + (p.delay ?? 0) < horizon &&
        (p.splash > 0
          ? spellContains({ x: p.tx, y: p.ty }, point, p.splash + entity.radius)
          : p.target === entity.id),
    )
    .map((p) => ({
      id: p.id,
      at: p.remaining + (p.delay ?? 0),
      damage: p.damage,
    }));
  if (entity.poison) {
    const next = poison.damageInterval - entity.poison.elapsed;
    for (
      let at = next;
      at < horizon && at <= entity.poison.remaining + 1e-8;
      at += poison.damageInterval
    )
      incoming.push({ id: -1, at, damage: CARD_MAP.poison.damage });
  }
  // Status ticks resolve before projectiles at the same time in the engine.
  incoming.sort((a, b) => a.at - b.at || a.id - b.id);
  for (const shot of incoming) {
    if (shield > 0) shield = Math.max(0, shield - shot.damage);
    else damage += shot.damage;
  }
  return damage;
}

function healValue(
  entity: Entity,
  enemies: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
): number {
  const missing = entity.maxHp - entity.hp;
  if (missing <= 0) return 0;
  const elapsed = entity.heal?.elapsed ?? 0;
  if (
    incomingBodyDamage(
      entity,
      entity,
      heal.healInterval - elapsed,
      projectiles,
    ) >= entity.hp
  )
    return 0;
  const fighting = enemies.some(
    (enemy) =>
      !hiddenSpellTarget(enemy) && hits(entity, enemy) && close(entity, enemy),
  );
  const dwell =
    !entity.active || fighting || entity.speed <= 0
      ? heal.duration
      : Math.min(heal.duration, (2 * heal.radius) / entity.speed);
  let existing = entity.heal?.remaining ?? 0;
  for (const area of areas)
    if (
      area.card === "heal" &&
      area.team === entity.team &&
      area.remaining > 0 &&
      spellContains(area, entity, area.radius + entity.radius)
    )
      existing = Math.max(
        existing,
        Math.min(dwell, area.remaining) + heal.buffDuration,
      );
  // Refreshes share one timer. Neither overlapping clouds nor the current
  // lingering buff are added together as independent healing streams.
  const reserved = ticks(existing, elapsed) * HEAL_PER_TICK;
  const available = Math.max(
    0,
    ticks(dwell + heal.buffDuration, elapsed) * HEAL_PER_TICK - reserved,
  );
  const restored = Math.min(Math.max(0, missing - reserved), available);
  return (aiBodyValue(entity) * restored) / entity.maxHp;
}

function cloneValue(
  entity: Entity,
  center: Point,
  enemies: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
): number {
  if (
    entity.clone ||
    entity.dash ||
    entity.stun > clone.buffDuration ||
    (entity.poison &&
      entity.poison.remaining + entity.poison.elapsed >= poison.damageInterval)
  )
    return 0;
  const engaged = enemies.some(
    (enemy) =>
      !hiddenSpellTarget(enemy) &&
      hits(entity, enemy) &&
      close(entity, enemy, 1),
  );
  if (!engaged && (entity.team === "red" ? entity.y < 16 : entity.y > 16))
    return 0;
  const copy = {
    ...entity,
    ...clonePosition(entity, center, entity.team),
    shield: 0,
  };
  if (
    areas.some((area) => {
      if (area.remaining <= 0) return false;
      if (area.team === entity.team)
        return (
          area.card === "clone" &&
          (spellContains(area, entity, area.radius + entity.radius) ||
            area.struck?.includes(entity.id))
        );
      // A pulse before Clone runs can attach Poison to the original; the copy
      // inherits that status even when its separation lands outside the cloud.
      if (
        area.card === "poison" &&
        spellContains(area, entity, area.radius + entity.radius)
      )
        return true;
      if (!spellContains(area, copy, area.radius + copy.radius)) return false;
      return (
        area.card === "poison" ||
        area.card === "tornado" ||
        (area.card === "freeze" && area.remaining > clone.buffDuration)
      );
    })
  )
    return 0;
  const firstAttack =
    clone.buffDuration +
    0.4 +
    Math.min(entity.interval, combatTraits(entity).windup);
  // The copy has a new ID; a single-target shot aimed at its original cannot
  // hit it. Area blasts can erase a copy before its first attack.
  if (
    incomingBodyDamage({ ...copy, id: -1 }, copy, firstAttack, projectiles) > 0
  )
    return 0;
  const exposed = enemies.some((enemy) => {
    if (
      hiddenSpellTarget(enemy) ||
      enemy.dash ||
      enemy.damage <= 0 ||
      !hits(enemy, copy) ||
      enemy.stun > clone.buffDuration ||
      areas.some(
        (area) =>
          area.card === "freeze" &&
          area.team === entity.team &&
          area.remaining > clone.buffDuration &&
          spellContains(area, enemy, area.radius + enemy.radius),
      )
    )
      return false;
    const splash =
      enemy.card === "tower"
        ? 0
        : enemy.card === "bowler"
          ? bowler.projectile.radius
          : (CARD_MAP[enemy.card].splash ?? 0);
    return splash > 0 && close(enemy, entity, splash);
  });
  return exposed ? 0 : aiBodyValue(entity);
}

/** Friendly support only: read current bodies/timers without advancing RNG or
 * simulation. Tactical value is useful restoration or surviving copied troops.
 */
export function supportSpellTarget(
  card: "heal" | "clone",
  team: Team,
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
  cost: number,
): SpellTarget | undefined {
  const living = entities.filter((entity) => entity.hp > 0);
  const friends = living.filter(
    (entity) => entity.team === team && entity.kind === "troop",
  );
  const enemies = living.filter((entity) => entity.team !== team);
  // Clone separates to one of two horizontal sides. Evaluate both once per
  // body, keeping expensive threat scans outside the candidate-point loop.
  const values = new Map(
    friends.map((entity) => {
      if (card === "heal") {
        const value = healValue(entity, enemies, areas, projectiles);
        return [entity.id, { left: value, right: value }] as const;
      }
      return [
        entity.id,
        {
          left: cloneValue(
            entity,
            { x: entity.x + 1, y: entity.y },
            enemies,
            areas,
            projectiles,
          ),
          right: cloneValue(entity, entity, enemies, areas, projectiles),
        },
      ] as const;
    }),
  );
  const targets = friends.filter((entity) => {
    const value = values.get(entity.id)!;
    return value.left > 0 || value.right > 0;
  });
  const radius = CARD_MAP[card].radius!;
  let best: SpellTarget | undefined;
  for (const point of spellCandidatePoints(targets, radius)) {
    let value = 0;
    for (const entity of targets)
      if (spellContains(point, entity, radius + entity.radius))
        value += values.get(entity.id)![entity.x < point.x ? "left" : "right"];
    const threshold = cost * 0.8;
    if (value < threshold) continue;
    const score = 3 + 2 * (value - threshold);
    if (!best || score > best.score + 1e-8) best = { ...point, score, value };
  }
  return best;
}
