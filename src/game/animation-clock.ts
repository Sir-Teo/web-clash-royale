import type { Entity } from "./engine";
import { COMBAT_STEP } from "./combat";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };

/** Presentation only: preserve phase when a troop's movement or control rate changes. */
export function advanceAnimationClock(entity: Entity, matchTime: number) {
  // Combat subtracts this step from stun before deciding whether it can act.
  const stopped = Math.max(0, entity.stun - COMBAT_STEP) > 0;
  if (
    entity.kind !== "troop" ||
    (!entity.rage &&
      !entity.slow &&
      !stopped &&
      entity.animationTime === undefined)
  )
    return;
  // Deployment keeps real time; its authored filters have independent clocks.
  const rate =
    entity.deploy > 0
      ? 1
      : stopped
        ? 0
        : (entity.rage ? rage.speedMultiplier : 1) *
          (entity.slow ? iceWizard.speedMultiplier : 1);
  entity.animationTime =
    (entity.animationTime ?? matchTime - COMBAT_STEP) + COMBAT_STEP * rate;
}
