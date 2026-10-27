import { attackRadius, attackReach, minimumAttackDistance } from "./attack-range";
import { attackClockRate } from "./attack-clock";
import type { AreaEffect, Entity, Point, Projectile } from "./engine";
import { COMBAT_STEP } from "./combat";
import { advanceMovement } from "./movement";
import { projectileDamagePackets } from "./projectile-impacts";
import { projectAreaFrames, type WindupFrame } from "./tornado-pull";
import rage from "./rage-data.json" with { type: "json" };

const controls = new Set<AreaEffect["card"]>([
  "rage",
  "freeze",
  "heal",
  "ice-golem",
]);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inRange = (body: Entity, target: Entity) =>
  distance(body, target) <= attackReach(body, target) &&
  (body.minimumRange === undefined || distance(body, target) >= minimumAttackDistance(body, target));

/** Stable Hog/Balloon approaches with ordinary homing shots or plain Arrows.
 * Targets stay fixed; separation, future attacks and target changes are omitted. */
export function createSpellApproachPaths(
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
  steps: number,
) {
  if (
    steps <= 0 ||
    projectiles.some(
      (p) =>
        p.remaining > 0 &&
        (p.damage <= 0 ||
          p.stun > 0 ||
          (p.slow ?? 0) > 0 ||
          (p.knockback ?? 0) > 0 ||
          !(
            (p.homing && p.source !== 0 && p.splash === 0) ||
            (!p.homing &&
              p.source === 0 &&
              p.style === "arrows" &&
              p.splash > 0 &&
              p.target === null)
          )),
    ) ||
    areas.some((a) => a.remaining > 0 && !controls.has(a.card))
  )
    return;
  // Another troop's current death can create bodies, damage or a Rage/slow
  // effect. These side effects are outside the approach path's status clocks.
  // Ignore shields and healing here to keep this rejection conservative.
  const releasedByTarget = new Map<number, number>();
  const arrows = projectiles.filter(
    (p) => p.remaining > 0 && p.source === 0 && p.style === "arrows",
  );
  for (const p of projectiles)
    if (p.remaining > 0 && p.target !== null)
      releasedByTarget.set(
        p.target,
        (releasedByTarget.get(p.target) ?? 0) + p.damage,
      );
  const doomedOthers = entities.filter(
    (e) =>
      e.kind === "troop" &&
      e.hp > 0 &&
      (releasedByTarget.get(e.id) ?? 0) +
        // Another troop's route is unknown here. Any compatible blast may
        // reach it; this upper bound deliberately omits distance and shields.
        arrows.reduce(
          (damage, p) =>
            damage + (p.team !== e.team && (p.air || !e.air) ? p.damage : 0),
          0,
        ) >=
        e.hp,
  );
  const cache = new Map<
    Entity,
    { positions: readonly Point[]; frames: readonly WindupFrame[] }
  >();
  const dataFor = (body: Entity) => {
    if (
      body.kind !== "troop" ||
      !body.active ||
      body.hp <= 0 ||
      body.speed <= 0 ||
      body.dash ||
      (body.card !== "hog-rider" && body.card !== "balloon")
    )
      return;
    if (doomedOthers.some((e) => e.id !== body.id)) return;
    if (entities.some((e) => e.team !== body.team && e.hp > 0 && e.burrow))
      return;
    const known = cache.get(body);
    if (known) return known;
    const targets = entities.filter(
      (e) =>
        e.hp > 0 &&
        e.team !== body.team &&
        e.kind !== "troop" &&
        !e.air &&
        !(e.deploy <= 0 && e.burrow?.phase === "hidden"),
    );
    const current = targets.find((e) => e.id === body.target);
    if (current && inRange(body, current)) return;
    let target: Entity | undefined,
      edge = Infinity;
    for (const candidate of targets) {
      const gap = distance(body, candidate) - candidate.radius;
      if (gap < edge) {
        target = candidate;
        edge = gap;
      }
    }
    if (
      !target ||
      target.burrow ||
      (target.poison?.remaining ?? 0) > 0 ||
      inRange(body, target)
    )
      return;
    const destination = target;
    const horizon = steps * COMBAT_STEP;
    if (
      entities.some(
        (e) =>
          e.id !== body.id &&
          e.team === body.team &&
          e.hp > 0 &&
          e.active &&
          (e.pendingAttack?.target === destination.id ||
            (e.target === destination.id && inRange(e, destination))),
      )
    )
      return;
    // Immediate first release and maximum Rage bound damage to the fixed
    // destination, along with its lifetime decay.
    const gap = Math.max(
      0,
      distance(body, target) - body.range - target.radius - attackRadius(body),
    );
    const first = gap / (body.speed * rage.speedMultiplier);
    const hits =
      first >= horizon
        ? 0
        : 1 +
          Math.ceil(
            ((horizon - first) * attackClockRate(body, true, false)) /
              Math.max(0.1, body.interval),
          );
    const decay = target.lifetime
      ? (target.maxHp * horizon) / target.lifetime
      : 0;
    const released = projectileDamagePackets(target, projectiles, entities)
      .filter((packet) => packet.step <= steps)
      .reduce((damage, packet) => damage + packet.damage, 0);
    if (target.hp <= body.damage * hits + decay + released + 1e-8) return;
    const mover = { ...body };
    let deploy = body.deploy;
    const frames = projectAreaFrames(body, areas, steps, (frame) => {
      mover.x = frame.position.x;
      mover.y = frame.position.y;
      if (deploy > 0) {
        deploy -= COMBAT_STEP;
        return frame.position;
      }
      if (frame.stun > 0) {
        mover.move = 0;
        return frame.position;
      }
      if (inRange(mover, destination)) {
        mover.move = 0;
        return frame.position;
      }
      mover.rage = frame.boost > 1e-8 ? { remaining: frame.boost } : undefined;
      mover.slow = frame.slow > 1e-8 ? { remaining: frame.slow } : undefined;
      advanceMovement(mover, destination);
      return { x: mover.x, y: mover.y };
    });
    const data = { frames, positions: frames.map((frame) => frame.position) };
    cache.set(body, data);
    return data;
  };
  return Object.assign((body: Entity) => dataFor(body)?.positions, {
    frames: (body: Entity) => dataFor(body)?.frames,
  });
}
