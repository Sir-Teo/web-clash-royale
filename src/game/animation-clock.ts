import type { Entity } from "./engine";
import { COMBAT_STEP } from "./combat";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };

/** Presentation only: preserve phase when a troop's movement buff changes. */
export function advanceAnimationClock(entity: Entity, matchTime: number) {
  if (
    entity.kind !== "troop" ||
    (!entity.rage && !entity.slow && entity.animationTime === undefined)
  )
    return;
  // Deployment keeps real time; its authored filters have independent clocks.
  const rate =
    entity.deploy > 0
      ? 1
      : (entity.rage ? rage.speedMultiplier : 1) *
        (entity.slow ? iceWizard.speedMultiplier : 1);
  entity.animationTime =
    (entity.animationTime ?? matchTime - COMBAT_STEP) + COMBAT_STEP * rate;
}
