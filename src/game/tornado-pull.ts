import { attackReach } from "./attack-range";
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
export interface WindupFrame {
  position: Point;
  areaPositions: readonly Point[];
  boost: number;
  slow: number;
  stun: number;
}
export interface WindupHealthFrame {
  beforeAlive: boolean;
  beforeInterrupt?: boolean;
  afterAlive: boolean;
  interrupt: boolean;
  slow: number;
}
export type WindupHealthEvaluator = (
  attacker: Entity,
  frames: readonly WindupFrame[],
  areas: readonly AreaEffect[],
  proposedIndex?: number,
) => readonly WindupHealthFrame[];

/** Read-only area movement and control clocks, also used to place every
 * possible Lightning target at its own position within each area update. */
export function projectAreaFrames(
  body: Entity,
  areas: readonly AreaEffect[],
  steps: number,
  advance?: (frame: WindupFrame) => Point,
): WindupFrame[] {
  const clouds = areas.map((a) => ({ ...a }));
  let position = { x: body.x, y: body.y };
  let boost = body.rage?.remaining ?? 0,
    slow = body.slow?.remaining ?? 0,
    stun = body.stun;
  const hidden = body.deploy <= 0 && body.burrow?.phase === "hidden";
  const frames: WindupFrame[] = [];
  for (let step = 1; step <= steps; step++) {
    const areaPositions: Point[] = [];
    for (const cloud of clouds) {
      areaPositions.push(position);
      if (cloud.remaining <= 0) continue;
      const inside = distance(position, cloud) < cloud.radius + body.radius;
      const age = cloud.duration - cloud.remaining;
      if (
        cloud.card === "ice-golem" &&
        cloud.team !== body.team &&
        inside &&
        !body.dash
      )
        slow = Math.max(slow, iceGolem.slowDuration);
      if (
        cloud.card === "freeze" &&
        cloud.team !== body.team &&
        inside &&
        !body.dash
      )
        stun = Math.max(stun, COMBAT_STEP * 2);
      if (cloud.card === "rage" && age + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + rage.areaHitInterval;
        if (cloud.team === body.team && inside && body.kind === "troop")
          boost = Math.max(boost, Math.min(rage.buffDuration, cloud.remaining));
      }
      if (cloud.card === "tornado" && age + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + tornado.areaHitInterval;
        if (
          cloud.team !== body.team &&
          inside &&
          body.kind === "troop" &&
          !hidden
        )
          position =
            tornadoPull({ ...position, speed: body.speed }, cloud) ?? position;
      }
      cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
      if (cloud.card !== "ice-golem" && cloud.remaining < 1e-8)
        cloud.remaining = 0;
    }
    boost = Math.max(0, boost - COMBAT_STEP);
    slow = Math.max(0, slow - COMBAT_STEP);
    stun = Math.max(0, stun - COMBAT_STEP);
    const frame = { position, areaPositions, boost, slow, stun };
    if (advance) frame.position = position = advance(frame);
    frames.push(frame);
  }
  return frames;
}

/** Areas that can change an existing attack, in their original update order. */
export function currentAttackAreas(
  target: Entity,
  areas: readonly AreaEffect[],
  proposed?: Point,
): AreaEffect[] {
  const clouds = areas.filter(
    (a) =>
      a.remaining > 0 &&
      [
        "tornado",
        "rage",
        "ice-golem",
        "freeze",
        "poison",
        "heal",
        "lightning",
      ].includes(a.card),
  );
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
  return clouds;
}

/** The same control clocks also retain the release position of an attack
 * that survives a pull, so its projectile flight can be recomputed. */
export function projectTornadoWindup(
  attacker: Entity,
  target: Entity,
  areas: readonly AreaEffect[],
  proposed?: Point,
  health?: WindupHealthEvaluator,
): WindupProjection {
  let position = { x: attacker.x, y: attacker.y };
  if (!attacker.pendingAttack) return { position };
  const clouds = currentAttackAreas(target, areas, proposed);
  let remaining = attacker.pendingAttack.remaining;
  const limit = health
    ? Math.min(
        60,
        Math.max(
          1,
          Math.ceil(
            (remaining + 1e-8) / (COMBAT_STEP * iceWizard.hitSpeedMultiplier),
          ),
        ),
      )
    : 60;
  const frames = projectAreaFrames(attacker, clouds, limit);
  return resolveWindup(
    attacker,
    target,
    frames,
    health?.(
      attacker,
      frames,
      clouds,
      proposed ? clouds.length - 1 : undefined,
    ),
  );
}

/** Resolve only the current windup against prepared control and health frames. */
export function resolveWindup(
  attacker: Entity,
  target: Entity,
  frames: readonly WindupFrame[],
  statuses?: readonly WindupHealthFrame[],
): WindupProjection {
  let position = { x: attacker.x, y: attacker.y };
  if (!attacker.pendingAttack) return { position };
  let remaining = attacker.pendingAttack.remaining;
  let shotSlow = 0;
  for (const [index, frame] of frames.entries()) {
    const step = index + 1,
      status = statuses?.[index];
    position = frame.position;
    shotSlow = Math.max(0, shotSlow - COMBAT_STEP);
    if (
      (status && (!status.beforeAlive || status.beforeInterrupt)) ||
      frame.stun > 0 ||
      distance(position, target) >
        attackReach(attacker, target)
    )
      return { position, cancelledStep: step };
    remaining -=
      COMBAT_STEP *
      (frame.boost >= 1e-8 ? rage.hitSpeedMultiplier : 1) *
      (Math.max(frame.slow, shotSlow) >= 1e-8
        ? iceWizard.hitSpeedMultiplier
        : 1);
    if (remaining <= 1e-8) return { position, releaseStep: step };
    if (status && (!status.afterAlive || status.interrupt))
      return { position, cancelledStep: step };
    shotSlow = Math.max(shotSlow, status?.slow ?? 0);
  }
  return { position };
}
