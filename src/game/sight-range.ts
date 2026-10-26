import { combatTraits } from "./combat";
import { NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import type { Entity } from "./engine";

type SightBody = Pick<Entity, "card" | "king" | "radius">;

/** Native resolved getter; candidate ranking and class extensions are separate. */
export const nativeSightRange = (
  body: SightBody,
  ownRadiusFactor = NATIVE_RANGE_RADIUS_FACTOR,
) => combatTraits(body).sight + body.radius * ownRadiusFactor;

/** Resolved sight is retained in snapshots; older recordings keep their bound. */
export const acquisitionSight = (
  body: Pick<Entity, "card" | "king" | "range" | "sightRange">,
) => body.sightRange ?? Math.max(combatTraits(body).sight, body.range);
