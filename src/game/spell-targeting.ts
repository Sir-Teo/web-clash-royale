import { aiBodyValue } from "./ai-body-value";
import { CARD_MAP, type CardId } from "./cards";
import { SPELL_CROWN_TOWER_DAMAGE_FRACTION } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import { createKingSpellRace, kingRacePriority } from "./king-damage";
import type { MatchFinisher } from "./match-finisher";

const DIRECT_SPELLS = new Set<CardId>(["fireball", "arrows", "zap", "rocket"]);
export const isDamageSpell = (card: CardId) => DIRECT_SPELLS.has(card);
export interface SpellTarget extends Point {
  score: number;
  value: number;
  lethalTower?: number;
  protectsKing?: boolean;
  matchDecisionStep?: number;
}
export const spellContains = (a: Point, b: Point, radius: number) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < radius ** 2;
export const hiddenSpellTarget = (e: Entity) =>
  e.deploy <= 0 && e.burrow?.phase === "hidden";

/** Shared legal centers for damage and area spells. */
export function spellCandidatePoints(
  entities: readonly Entity[],
  radius: number,
): Point[] {
  const points = new Map<string, Point>();
  const add = (x: number, y: number) => {
    const point = {
      x: Math.max(0.5, Math.min(17.5, x)),
      y: Math.max(0.7, Math.min(31.3, y)),
    };
    points.set(`${point.x.toFixed(3)},${point.y.toFixed(3)}`, point);
  };
  for (const e of entities) add(e.x, e.y);
  // Midpoints can cover a pair that cannot both be hit from either body.
  // Deduplication bounds the common case of tightly packed swarms.
  for (let i = 0; i < entities.length; i++)
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i],
        b = entities[j];
      if (spellContains(a, b, 2 * radius + a.radius + b.radius))
        add((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  return [...points.values()];
}

/** Conservative future damage at current positions. Poison overlaps refresh
 * one status; reserve the longest cloud, never the sum of overlapping clouds.
 */
export function pendingSpellDamage(
  entity: Entity,
  team: Team,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
): number {
  if (entity.team === team || hiddenSpellTarget(entity) || entity.dash)
    return 0;
  let shield = entity.shield ?? 0;
  let shots = 0;
  // Shields absorb an entire packet: damage beyond a shield's remaining HP
  // never reaches the body. Preserve arrival order when reserving future hits.
  const incoming = projectiles
    .filter(
      (p) =>
        p.team === team &&
        p.source === 0 &&
        p.remaining > 0 &&
        (p.air || !entity.air) &&
        spellContains({ x: p.tx, y: p.ty }, entity, p.splash + entity.radius),
    )
    .sort((a, b) => a.remaining - b.remaining || a.id - b.id);
  for (const p of incoming) {
    const damage =
      p.damage *
      (entity.kind === "tower"
        ? (p.towerDamageFraction ?? SPELL_CROWN_TOWER_DAMAGE_FRACTION)
        : 1);
    if (shield > 0) {
      const absorbed = Math.min(shield, damage);
      shots += absorbed;
      shield -= absorbed;
    } else shots += damage;
  }
  let cloud = 0;
  if (entity.kind !== "troop")
    for (const area of areas)
      if (
        area.team === team &&
        area.card === "poison" &&
        area.remaining > 0 &&
        spellContains(area, entity, area.radius + entity.radius)
      )
        cloud = Math.max(
          cloud,
          Math.floor(area.remaining / poison.damageInterval) *
            CARD_MAP.poison.damage *
            (entity.kind === "tower" ? poison.crownTowerDamageFraction : 1),
        );
  return shots + cloud;
}

/** Evaluate visible current positions only; no simulation or random draws.
 * Unit value is measured per body (so swarms aren't counted as whole cards).
 * A pending friendly blast reserves damage at its fixed destination.
 */
export function damageSpellTarget(
  card: CardId,
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
  cost = CARD_MAP[card].cost,
  kingDeadline = Infinity,
  finisher?: MatchFinisher,
): SpellTarget | undefined {
  if (!isDamageSpell(card)) return;
  const rules = CARD_MAP[card],
    radius = rules.radius!;
  const enemies = entities.filter(
    (e) =>
      e.team !== team &&
      e.hp > 0 &&
      !hiddenSpellTarget(e) &&
      !e.dash &&
      (!e.air || rules.hitsAir),
  );
  const enemyKing = enemies.find((e) => e.king);
  const race =
    !finisher && Number.isFinite(kingDeadline) && enemyKing
      ? createKingSpellRace(card, team, enemyKing, projectiles, areas, entities)
      : undefined;
  const targets = enemies
    .map((entity) => {
      const reserved = pendingSpellDamage(entity, team, projectiles, areas);
      return {
        entity,
        hp: Math.max(0, entity.hp + (entity.shield ?? 0) - reserved),
        shield: Math.max(0, (entity.shield ?? 0) - reserved),
      };
    })
    .filter((t) =>
      finisher && t.entity.kind === "tower"
        ? true
        : t.entity.king && race
          ? race.baseline >= kingDeadline
          : t.hp > 1e-6,
    );
  if (!targets.length) return;
  const points = spellCandidatePoints(
    targets.map((t) => t.entity),
    radius,
  );
  // Precompute point-independent value once, keeping the candidate scan cheap
  // even on a board near the troop population limit.
  const evaluated = targets.map(({ entity: e, hp, shield }) => {
    const packet =
      rules.damage *
      (e.kind === "tower"
        ? card === "rocket"
          ? rocket.crownTowerDamageFraction
          : 0.4
        : 1);
    const damage = shield > 0 ? Math.min(shield, packet) : packet;
    if (e.kind === "tower")
      return {
        entity: e,
        radius: radius + e.radius,
        value: hp <= damage + 1e-6 ? 0 : (Math.min(damage, hp) / e.maxHp) * 2,
        penalty: hp > damage + 1e-6 && e.king && !e.active ? cost + 8 : 0,
        lethal: hp > 1e-6 && hp <= damage + 1e-6,
      };
    const bodyCost = aiBodyValue(e);
    const removal = hp <= damage + 1e-6 ? 0.35 : 0;
    const defense = (team === "red" ? e.y < 15 : e.y > 17) ? 1.2 : 1;
    return {
      entity: e,
      radius: radius + e.radius,
      value:
        bodyCost *
        Math.min(
          1,
          Math.min(damage, hp) / (e.maxHp + (e.maxShield ?? 0)) + removal,
        ) *
        defense,
      penalty: 0,
      lethal: false,
    };
  });
  let best: SpellTarget | undefined;
  for (const point of points) {
    let value = 0,
      penalty = 0,
      kingStep = Infinity,
      lethalTower: Entity | undefined;
    for (const target of evaluated) {
      if (!spellContains(point, target.entity, target.radius)) continue;
      if (target.entity.king && race) {
        const step = race.stepAt(point);
        if (step < race.baseline) {
          lethalTower = target.entity;
          kingStep = step;
          continue;
        }
        value += target.value;
        penalty += target.penalty;
        continue;
      }
      value += target.value;
      penalty += target.penalty;
      if (!finisher && target.lethal && (!lethalTower || target.entity.king))
        lethalTower = target.entity;
    }
    // Overtime uses the match forecast exclusively for lethal priority. A
    // queued earlier victory must not fall back to the regulation kill score.
    const match = finisher?.evaluate(card, point, cost, value);
    const score =
      match?.score ??
      (lethalTower?.king && race
        ? kingRacePriority(kingStep, kingDeadline) -
          cost +
          Math.min(100, value) -
          penalty
        : lethalTower
          ? (lethalTower.king ? 10_000 : 40) - cost + value - penalty
          : 3 + 2 * (value - cost * 0.8) - penalty);
    if (!match && !lethalTower && (value < cost * 0.8 || score <= 0)) continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(match ? { matchDecisionStep: match.matchDecisionStep } : {}),
        ...(lethalTower ? { lethalTower: lethalTower.id } : {}),
      };
  }
  return best;
}
