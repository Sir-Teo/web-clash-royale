import type { AreaEffect, Entity, Point, Team } from "./engine";
import { COMBAT_STEP } from "./combat";
import { impactSteps } from "./projectile-impacts";
import { meleeInterceptTarget } from "./melee-intercept";
import miner from "./miner-data.json" with { type: "json" };

/** A legal melee lead must cover the tunnel to that very landing point. */
export function minerInterceptTarget(
  team: Team,
  threat: Entity,
  entities: readonly Entity[],
  legal: (point: Point) => boolean,
  areas: readonly AreaEffect[] = [],
): Point | undefined {
  const origin = { x: 9, y: team === "red" ? 3 : 29 };
  // One arena diagonal bounds every legal flight. Scan whole simulation steps
  // so a ceiling boundary cannot make a fixed-point iteration oscillate.
  const maximum = impactSteps(Math.hypot(18, 32) / miner.travelSpeed);
  for (let steps = 1; steps <= maximum; steps++) {
    const point = meleeInterceptTarget(
      "miner",
      team,
      threat,
      entities,
      legal,
      areas,
      steps * COMBAT_STEP,
    );
    if (!point) continue;
    const arrival = impactSteps(
      Math.hypot(point.x - origin.x, point.y - origin.y) / miner.travelSpeed,
    );
    // Accept at most one step of conservative lead at a discrete boundary.
    // Longer budgets would invent waiting time that the tunnel does not need.
    if (arrival <= steps && steps - arrival <= 1) return point;
  }
}
