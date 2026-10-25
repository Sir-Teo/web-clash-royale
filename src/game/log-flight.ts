import { CARD_MAP } from "./cards";
import type { Entity, Point, Projectile, Team } from "./engine";
import log from "./log-data.json" with { type: "json" };

/** Proposed current-rule cast, without allocating a simulation ID. */
export function logSpellProjectile(team: Team, point: Point): Projectile {
  const duration = log.launchMinimumDistance / log.launchSpeed;
  return {
    id: -1,
    team,
    x: point.x,
    y: point.y,
    tx: point.x,
    ty: point.y + (team === "blue" ? -1 : 1) * log.launchMinimumDistance,
    target: null,
    damage: CARD_MAP.log.damage,
    remaining: duration,
    duration,
    splash: 0,
    air: false,
    style: "log-launch",
    stun: 0,
    source: 0,
    flight: { ...point },
    speed: log.launchSpeed,
    elapsed: 0,
    fromHeight: 2.1,
    toHeight: 0.35,
    arc: 1.2,
  };
}

/** Full swept rolling corridor against a fixed body, after the landing. */
export function logSpellContains(team: Team, point: Point, body: Entity) {
  const direction = team === "blue" ? -1 : 1;
  const landing = point.y + direction * log.launchMinimumDistance;
  const range = Math.min(
    log.rollingRange,
    team === "blue" ? landing - 0.6 : 31.4 - landing,
  );
  const end = landing + direction * range;
  return (
    range > 0 &&
    Math.abs(body.x - point.x) < log.collisionHalfWidth + body.radius &&
    body.y >= Math.min(landing, end) - log.collisionRadius - body.radius &&
    body.y <= Math.max(landing, end) + log.collisionRadius + body.radius
  );
}

/** Body centers and overlapping horizontal intervals supply legal lanes.
 * Each body supplies landing positions at its front, center and rear. */
export function logCandidatePoints(team: Team, bodies: readonly Entity[]) {
  const direction = team === "blue" ? -1 : 1;
  const points = new Map<string, Point>();
  const add = (x: number, body: Entity) => {
    for (const offset of [
      log.collisionRadius + body.radius,
      0,
      -log.collisionRadius - body.radius,
    ]) {
      const point = {
        x: Math.max(0.5, Math.min(17.5, x)),
        y: Math.max(
          team === "blue" ? 17.5 : 0.7,
          Math.min(
            team === "blue" ? 31.3 : 14.5,
            body.y + direction * (offset - log.launchMinimumDistance),
          ),
        ),
      };
      points.set(`${point.x.toFixed(3)},${point.y.toFixed(3)}`, point);
    }
  };
  for (const body of bodies) add(body.x, body);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      if (
        Math.abs(a.y - b.y) >
        log.rollingRange + 2 * log.collisionRadius + a.radius + b.radius
      )
        continue;
      const left = Math.max(
        a.x - a.radius - log.collisionHalfWidth,
        b.x - b.radius - log.collisionHalfWidth,
      );
      const right = Math.min(
        a.x + a.radius + log.collisionHalfWidth,
        b.x + b.radius + log.collisionHalfWidth,
      );
      if (left >= right) continue;
      const x = (left + right) / 2;
      add(x, a);
      add(x, b);
    }
  return [...points.values()];
}
