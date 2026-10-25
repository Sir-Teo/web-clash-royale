import type { AreaEffect, Entity, Point } from "./engine";
import { projectAreaFrames } from "./tornado-pull";

/** Current pulls only: no walking, separation or future projectile knockback.
 * Cache one complete projectile-phase position path per affected body. */
export function createSpellPullPaths(
  areas: readonly AreaEffect[],
  steps: number,
) {
  const pulls = areas.filter((a) => a.card === "tornado" && a.remaining > 0);
  if (!pulls.length || steps <= 0) return;
  const cache = new Map<Entity, readonly Point[]>();
  return (body: Entity): readonly Point[] | undefined => {
    if (
      body.kind !== "troop" ||
      body.speed <= 0 ||
      !pulls.some(
        (a) =>
          a.team !== body.team &&
          Math.hypot(a.x - body.x, a.y - body.y) < a.radius + body.radius,
      )
    )
      return;
    let path = cache.get(body);
    if (!path) {
      path = projectAreaFrames(body, pulls, steps).map(
        (frame) => frame.position,
      );
      cache.set(body, path);
    }
    return path;
  };
}
