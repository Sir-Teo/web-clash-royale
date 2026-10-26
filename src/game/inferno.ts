import tower from "./inferno-tower-data.json" with { type: "json" };
import dragon from "./inferno-dragon-data.json" with { type: "json" };
import clock from "./inferno-clock-data.json" with { type: "json" };

export type InfernoCard = "inferno-tower" | "inferno-dragon";
export const infernoProfile = (card: InfernoCard) =>
  card === "inferno-tower" ? tower : dragon;

export interface InfernoClock {
  elapsed: number;
  hitTimer: number;
  stage: 0 | 1 | 2;
}

/** Native integer deltas retain both divisions' truncation before resampling. */
export function infernoAttackRate(raged: boolean, slowed: boolean) {
  return (
    clock.deltasMs[
      raged ? (slowed ? "both" : "rage") : slowed ? "slow" : "normal"
    ] / clock.stepMs
  );
}

/** Eligible active lock only: targeting, initial load and interruptions remain
 * the caller's responsibility. The caller gates earlier recordings. */
export function advanceInfernoClock(
  card: InfernoCard,
  lock: InfernoClock,
  step: number,
  raged: boolean,
  slowed: boolean,
) {
  const delta = step * infernoAttackRate(raged, slowed);
  lock.elapsed += delta;
  const source = infernoProfile(card);
  const elapsed = lock.elapsed + 1e-8;
  lock.stage =
    elapsed >= source.stageDurations[0] + source.stageDurations[1]
      ? 2
      : elapsed >= source.stageDurations[0]
        ? 1
        : 0;
  lock.hitTimer -= delta;
}

/** Current roster normalization, shared by spawning, beam hits and card details. */
export function infernoDamage(card: InfernoCard, stage: 0 | 1 | 2) {
  const scale = card === "inferno-tower" ? 1152 / 450 : 1.1 ** 2;
  return Math.round(infernoProfile(card).sourceDamage[stage] * scale);
}
