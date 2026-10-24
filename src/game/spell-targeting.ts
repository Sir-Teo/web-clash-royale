import { CARD_MAP, type CardId } from "./cards";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };

const DIRECT_SPELLS = new Set<CardId>(["fireball", "arrows", "zap", "rocket"]);
export const isDamageSpell = (card: CardId) => DIRECT_SPELLS.has(card);
export interface SpellTarget extends Point {
  score: number;
  value: number;
  lethalTower?: number;
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
  if (entity.team === team || hiddenSpellTarget(entity)) return 0;
  const shots = projectiles.reduce((sum, p) => {
    if (
      p.team !== team ||
      p.source !== 0 ||
      p.remaining <= 0 ||
      (!p.air && entity.air) ||
      !spellContains({ x: p.tx, y: p.ty }, entity, p.splash + entity.radius)
    )
      return sum;
    return (
      sum +
      p.damage *
        (entity.kind === "tower" ? (p.crownTowerDamageFraction ?? 0.3) : 1)
    );
  }, 0);
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
): SpellTarget | undefined {
  if (!isDamageSpell(card)) return;
  const rules = CARD_MAP[card],
    radius = rules.radius!;
  const enemies = entities.filter(
    (e) =>
      e.team !== team &&
      e.hp > 0 &&
      !hiddenSpellTarget(e) &&
      (!e.air || rules.hitsAir),
  );
  const targets = enemies
    .map((entity) => {
      const reserved = pendingSpellDamage(entity, team, projectiles, areas);
      return { entity, hp: Math.max(0, entity.hp - reserved) };
    })
    .filter((t) => t.hp > 1e-6);
  if (!targets.length) return;
  const points = spellCandidatePoints(
    targets.map((t) => t.entity),
    radius,
  );
  // Precompute point-independent value once, keeping the candidate scan cheap
  // even on a board near the troop population limit.
  const evaluated = targets.map(({ entity: e, hp }) => {
    const damage =
      rules.damage *
      (e.kind === "tower"
        ? card === "rocket"
          ? rocket.crownTowerDamageFraction
          : 0.3
        : 1);
    if (e.kind === "tower")
      return {
        entity: e,
        radius: radius + e.radius,
        value: hp <= damage + 1e-6 ? 0 : (Math.min(damage, hp) / e.maxHp) * 2,
        penalty: hp > damage + 1e-6 && e.king && !e.active ? rules.cost + 8 : 0,
        lethal: e.kind === "tower" && hp <= damage + 1e-6,
      };
    const source = CARD_MAP[e.card as CardId],
      bodyCost = source.cost / source.count;
    const removal = hp <= damage + 1e-6 ? 0.35 : 0;
    const defense = (team === "red" ? e.y < 15 : e.y > 17) ? 1.2 : 1;
    return {
      entity: e,
      radius: radius + e.radius,
      value:
        bodyCost *
        Math.min(1, Math.min(damage, hp) / e.maxHp + removal) *
        defense,
      penalty: 0,
      lethal: false,
    };
  });
  let best: SpellTarget | undefined;
  for (const point of points) {
    let value = 0,
      penalty = 0,
      lethalTower: Entity | undefined;
    for (const target of evaluated) {
      if (!spellContains(point, target.entity, target.radius)) continue;
      value += target.value;
      penalty += target.penalty;
      if (target.lethal && (!lethalTower || target.entity.king))
        lethalTower = target.entity;
    }
    // A guaranteed King kill wins the match, regardless of nearby troop value.
    const score = lethalTower
      ? (lethalTower.king ? 10_000 : 40) - rules.cost + value - penalty
      : 3 + 2 * (value - rules.cost * 0.8) - penalty;
    if (!lethalTower && (value < rules.cost * 0.8 || score <= 0)) continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(lethalTower ? { lethalTower: lethalTower.id } : {}),
      };
  }
  return best;
}
