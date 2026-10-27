import type { Entity } from "./engine";
import clock from "./attack-clock-data.json" with { type: "json" };
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };

/** Resample the shared native integer update; older bodies retain their exact
 * decimal multiplication order. Movement and deployment use separate clocks. */
export function attackClockRate(
  body: Pick<Entity, "nativeAttackClock">,
  raged: boolean,
  slowed: boolean,
) {
  if (!body.nativeAttackClock)
    return (
      (raged ? rage.hitSpeedMultiplier : 1) *
      (slowed ? iceWizard.hitSpeedMultiplier : 1)
    );
  return (
    clock.deltasMs[
      raged ? (slowed ? "both" : "rage") : slowed ? "slow" : "normal"
    ] / clock.stepMs
  );
}

/** Historical forecasts multiplied step, Rage and slow from left to right. */
export function attackClockDelta(
  body: Pick<Entity, "nativeAttackClock">,
  step: number,
  raged: boolean,
  slowed: boolean,
) {
  return body.nativeAttackClock
    ? step * attackClockRate(body, raged, slowed)
    : step *
        (raged ? rage.hitSpeedMultiplier : 1) *
        (slowed ? iceWizard.hitSpeedMultiplier : 1);
}
