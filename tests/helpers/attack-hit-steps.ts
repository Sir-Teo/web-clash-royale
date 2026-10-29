import { COMBAT_STEP } from "../../src/game/combat";
import { attackFlight } from "../../src/game/attack-flight";
import type { Entity } from "../../src/game/engine";

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** One-based hit step, counting the release frame. Rules 43 shots start later.
 * Rolling/returning attacks use first swept contact, not endpoint arrival. */
export function attackHitSteps(attacker: Entity, target: Entity): number {
  const flight = attackFlight(attacker, target);
  if (!flight) return 1;
  const delay = attacker.nativeProjectileStep ? 1 : 0;
  const total = Math.max(1, Math.ceil((flight.duration - 1e-8) / COMBAT_STEP));
  if (flight.contactRadius === undefined) return total + delay;
  let position = { ...flight.start };
  for (let step = 1; step <= total; step++) {
    const dx = flight.end.x - position.x,
      dy = flight.end.y - position.y;
    const distance = Math.hypot(dx, dy);
    const travel = Math.min(distance, flight.speed! * COMBAT_STEP);
    const next =
      distance > 0
        ? {
            x: position.x + (dx / distance) * travel,
            y: position.y + (dy / distance) * travel,
          }
        : { ...position };
    const sx = next.x - position.x,
      sy = next.y - position.y;
    const segment = sx * sx + sy * sy;
    const progress =
      segment > 0
        ? clamp(
            ((target.x - position.x) * sx + (target.y - position.y) * sy) /
              segment,
            0,
            1,
          )
        : 0;
    if (
      Math.hypot(
        target.x - (position.x + sx * progress),
        target.y - (position.y + sy * progress),
      ) <=
      flight.contactRadius + target.radius
    )
      return step + delay;
    position = next;
  }
  return Infinity;
}
