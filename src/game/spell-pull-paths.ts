import type { AreaEffect, Entity, Point } from "./engine";
import { projectAreaFrames, type WindupFrame } from "./tornado-pull";

/** Current pulls only: no walking, separation or future projectile knockback.
 * Cache one complete projectile-phase position path per affected body. */
export function createSpellPullPaths(
  areas: readonly AreaEffect[],
  steps: number,
) {
  const pulls = areas.filter((a) => a.card === "tornado" && a.remaining > 0);
  if (!pulls.length || steps <= 0) return;
  const cache = new Map<
    Entity,
    { positions: readonly Point[]; frames: readonly WindupFrame[] }
  >();
  const dataFor = (body: Entity) => {
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
    let data = cache.get(body);
    if (!data) {
      const frames = projectAreaFrames(body, areas, steps);
      data = { frames, positions: frames.map((frame) => frame.position) };
      cache.set(body, data);
    }
    return data;
  };
  return Object.assign((body: Entity) => dataFor(body)?.positions, {
    frames: (body: Entity) => dataFor(body)?.frames,
  });
}
