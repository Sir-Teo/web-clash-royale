import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point } from "./engine";
import tornado from "./tornado-data.json" with { type: "json" };
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import iceGolem from "./ice-golem-data.json" with { type: "json" };

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** One native pull beat, using base movement speed and arena limits. */
export function tornadoPull(
  body: Point & { speed: number },
  center: Point,
): Point | undefined {
  const dx = center.x - body.x,
    dy = center.y - body.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 0.001)) return;
  const travel = Math.min(
    gap,
    body.speed * tornado.attractPercentage * tornado.areaHitInterval,
  );
  return {
    x: clamp(body.x + (dx / gap) * travel, 0.5, 17.5),
    y: clamp(body.y + (dy / gap) * travel, 0.6, 31.4),
  };
}

/** Can known pulls cancel this current windup before release? Hold the target
 * and other bodies fixed; do not predict new attacks, damage or separation. */
export function tornadoEscapeStep(
  attacker: Entity,
  target: Entity,
  areas: readonly AreaEffect[],
  proposed?: Point,
): number | undefined {
  return projectTornadoWindup(attacker, target, areas, proposed).cancelledStep;
}

export interface WindupProjection {
  position: Point;
  cancelledStep?: number;
  releaseStep?: number;
}

/** The same control clocks also retain the release position of an attack
 * that survives a pull, so its projectile flight can be recomputed. */
export function projectTornadoWindup(
  attacker: Entity,
  target: Entity,
  areas: readonly AreaEffect[],
  proposed?: Point,
): WindupProjection {
  let position = { x: attacker.x, y: attacker.y };
  if (!attacker.pendingAttack) return { position };
  const clouds = areas
    .filter(
      (a) =>
        a.remaining > 0 &&
        ["tornado", "rage", "ice-golem", "freeze"].includes(a.card),
    )
    .map((a) => ({ ...a }));
  if (proposed)
    clouds.push({
      id: -1,
      card: "tornado",
      team: target.team,
      x: proposed.x,
      y: proposed.y,
      radius: tornado.radius,
      duration: tornado.duration,
      remaining: tornado.duration,
      hitAt: 0,
    });
  let boost = attacker.rage?.remaining ?? 0,
    slow = attacker.slow?.remaining ?? 0,
    stun = attacker.stun;
  let remaining = attacker.pendingAttack.remaining;
  for (let step = 1; step <= 60; step++) {
    for (const cloud of clouds) {
      if (cloud.remaining <= 0) continue;
      const inside = distance(position, cloud) < cloud.radius + attacker.radius;
      const age = cloud.duration - cloud.remaining;
      if (
        cloud.card === "ice-golem" &&
        cloud.team !== attacker.team &&
        inside &&
        !attacker.dash
      )
        slow = Math.max(slow, iceGolem.slowDuration);
      if (
        cloud.card === "freeze" &&
        cloud.team !== attacker.team &&
        inside &&
        !attacker.dash
      )
        stun = Math.max(stun, COMBAT_STEP * 2);
      if (cloud.card === "rage" && age + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + rage.areaHitInterval;
        if (cloud.team === attacker.team && inside && attacker.kind === "troop")
          boost = Math.max(boost, Math.min(rage.buffDuration, cloud.remaining));
      }
      if (cloud.card === "tornado" && age + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + tornado.areaHitInterval;
        if (cloud.team !== attacker.team && inside && attacker.kind === "troop")
          position =
            tornadoPull({ ...position, speed: attacker.speed }, cloud) ??
            position;
      }
      cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
      if (cloud.card !== "ice-golem" && cloud.remaining < 1e-8)
        cloud.remaining = 0;
    }
    boost = Math.max(0, boost - COMBAT_STEP);
    slow = Math.max(0, slow - COMBAT_STEP);
    stun = Math.max(0, stun - COMBAT_STEP);
    if (
      stun > 0 ||
      distance(position, target) >
        attacker.range + target.radius + attacker.radius * 0.35
    )
      return { position, cancelledStep: step };
    remaining -=
      COMBAT_STEP *
      (boost >= 1e-8 ? rage.hitSpeedMultiplier : 1) *
      (slow >= 1e-8 ? iceWizard.hitSpeedMultiplier : 1);
    if (remaining <= 1e-8) return { position, releaseStep: step };
  }
  return { position };
}
