import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point, Team } from "./engine";
import lightning from "./lightning-data.json" with { type: "json" };
import { CARD_MAP } from "./cards";
import type { DamagePacket } from "./projectile-impacts";

const eligible = (e: Entity, team: Team, struck: readonly number[]) =>
  e.hp > 0 &&
  e.team !== team &&
  !(e.deploy <= 0 && e.burrow?.phase === "hidden") &&
  !struck.includes(e.id);
const order = (a: Entity, b: Entity) => b.hp - a.hp || a.id - b.id;
const contains = (point: Point, e: Entity, radius: number) =>
  Math.hypot(e.x - point.x, e.y - point.y) < radius + e.radius;

/** Exact live-pulse eligibility, current-health priority and ID tie break. */
export function selectLightningTarget(
  team: Team,
  point: Point,
  radius: number,
  entities: readonly Entity[],
  struck: readonly number[],
) {
  return entities
    .filter((e) => eligible(e, team, struck) && contains(point, e, radius))
    .sort(order)[0];
}

/** Fixed-position future slots. Movement, later health changes and summons
 * are not simulated; current struck history and pulse clocks are preserved. */
export function createLightningPlan(
  team: Team,
  entities: readonly Entity[],
  area?: AreaEffect,
) {
  const ordered = entities
    .filter((e) => eligible(e, team, area?.struck ?? []))
    .sort(order);
  let remaining = area?.remaining ?? lightning.duration;
  const duration = area?.duration ?? lightning.duration;
  let next = area?.hitAt ?? lightning.strikeInterval;
  const steps: number[] = [];
  for (let step = 1; remaining > 1e-8; step++) {
    if (duration - remaining + 1e-8 >= next) {
      steps.push(step);
      next += lightning.strikeInterval;
    }
    remaining = Math.max(0, remaining - COMBAT_STEP);
  }
  return (point: Point, radius = lightning.radius) =>
    ordered
      .filter((e) => contains(point, e, radius))
      .slice(0, steps.length)
      .map((entity, index) => ({ entity, step: steps[index] }));
}

export const lightningStrikes = (
  team: Team,
  point: Point,
  entities: readonly Entity[],
  area?: AreaEffect,
) => createLightningPlan(team, entities, area)(point, area?.radius);

/** Prepare each area's selection once for a whole-board decision. */
export function lightningDamageMap(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
) {
  const packets = new Map<number, DamagePacket[]>();
  areas.forEach((area, order) => {
    if (area.card !== "lightning" || area.remaining <= 0) return;
    for (const { entity, step } of lightningStrikes(
      area.team,
      area,
      entities,
      area,
    )) {
      const hits = packets.get(entity.id) ?? [];
      hits.push({
        step,
        damage:
          CARD_MAP.lightning.damage *
          (entity.kind === "tower" ? lightning.crownTowerDamageFraction : 1),
        phase: -1,
        born: 0,
        order,
      });
      packets.set(entity.id, hits);
    }
  });
  return packets;
}
