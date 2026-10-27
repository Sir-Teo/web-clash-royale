import type { Entity, Point } from "./engine";
import { attackReach } from "./attack-range";
import { combatTraits } from "./combat";
import source from "./pending-range-data.json" with { type: "json" };

/** Source Data projectile presence, independent of rendered attack artwork. */
export function hasPendingRange(card: Entity["card"], king?: boolean) {
  return source.projectileSources.includes(combatTraits({ card, king }).source);
}

/** The browser windup is the remainder of HitSpeed after source LoadTime.
 * Range is checked before this update advances that existing attack clock. */
export function pendingAttackReach(
  body: Pick<
    Entity,
    | "range"
    | "radius"
    | "rangeRadiusFactor"
    | "interval"
    | "pendingAttack"
    | "nativePendingRange"
  >,
  target: Pick<Entity, "radius">,
) {
  let extra = 0;
  if (body.nativePendingRange && body.pendingAttack && body.interval > 0) {
    const elapsed = (body.interval - body.pendingAttack.remaining) * 1000;
    const integer = Math.round(elapsed);
    const milliseconds =
      Math.abs(elapsed - integer) <= 1e-7 ? integer : elapsed;
    const interval = body.interval * 1000;
    if (
      milliseconds >= 0 &&
      milliseconds % interval > source.startedThresholdMs
    )
      extra = source.extraRange;
  }
  return attackReach(body, target) + extra;
}

export function pendingAttackInRange(
  body: Parameters<typeof pendingAttackReach>[0] & Point,
  target: Pick<Entity, "radius"> & Point,
) {
  const distance = Math.hypot(body.x - target.x, body.y - target.y);
  const reach = pendingAttackReach(body, target);
  // Absorb coordinate subtraction noise only at the newly extended boundary.
  return (
    distance <= reach ||
    (reach > attackReach(body, target) && distance - reach <= 1e-10)
  );
}
