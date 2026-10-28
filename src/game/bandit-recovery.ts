import bandit from "./bandit-data.json" with { type: "json" };
import reset from "./bandit-reset-data.json" with { type: "json" };

/** Post-landing ordinary clock. Reload uses real time; elapsed uses the
 * integer attack modifier. Rules 52 consume only its first request. */
export interface BanditRecoveryClock {
  elapsedMs: number;
  reloadMs: number;
  carry: number;
  animating?: true;
  /** Rules 56: selected reference and the source removal finish clock. */
  target?: number;
  finishMs?: number;
}

const frameMs = bandit.dash.startup.stepMs;
const frameTime = frameMs / 1000;
const loadMs = bandit.sourceLoadTime * 1000;
const intervalMs = bandit.sourceHitSpeed * 1000;

export function advanceBanditRecovery(
  clock: BanditRecoveryClock,
  step: number,
  rate: number,
  active: boolean | "targetless" = true,
  resetElapsed = false,
): boolean {
  clock.carry = Math.min(frameTime, Math.max(0,
    Number.isFinite(clock.carry) ? clock.carry : 0)) + step;
  while (clock.carry + 1e-8 >= frameTime) {
    clock.carry = Math.max(0, clock.carry - frameTime);
    clock.reloadMs = Math.max(0, clock.reloadMs - frameMs);
    if (active !== true) {
      if (active === "targetless" && (clock.finishMs ?? 0) > 0) {
        clock.finishMs! += frameMs;
        if (clock.finishMs! >= reset.finishTimeMs) resetBanditRecoveryPhase(clock);
      } else if (resetElapsed || active === "targetless") resetBanditRecoveryPhase(clock);
      continue;
    }
    const cycle = Math.trunc(clock.elapsedMs / intervalMs);
    if (clock.elapsedMs === 0) {
      clock.elapsedMs += loadMs - clock.reloadMs;
      clock.reloadMs = loadMs;
    }
    clock.elapsedMs += Math.round(frameMs * rate);
    if (Math.trunc(clock.elapsedMs / intervalMs) !== cycle) {
      clock.reloadMs = loadMs;
      return true;
    }
  }
  return false;
}

/** Native inactive and out-of-range setter clears retain real-time reload. */
export function resetBanditRecoveryPhase(clock: BanditRecoveryClock): void {
  clock.elapsedMs = 0;
  delete clock.animating;
  delete clock.finishMs;
}

/** Actual setter/removal boundaries; target choice remains the caller's job. */
export function bindBanditRecovery(clock: BanditRecoveryClock, target: number | undefined,
  inRange = true, removed = false): void {
  if (clock.target === target) return;
  if (target === undefined) {
    delete clock.target;
    if (removed && clock.elapsedMs > 0) clock.finishMs = 1;
  } else {
    clock.target = target;
    if (!inRange) resetBanditRecoveryPhase(clock);
  }
}

/** Logical seconds for existing windup guards. Forecasts advance a clone of
 * the exact clock so modifier expiry and the remaining frame phase survive. */
export function banditRecoveryRemaining(clock: BanditRecoveryClock, rate: number): number {
  const projected = { ...clock, carry: 0 };
  for (let frames = 1; frames <= 100; frames++) {
    if (advanceBanditRecovery(projected, frameTime, rate))
      return Math.max(0, frames * frameTime - clock.carry) * rate;
  }
  return Infinity;
}

/** The complete native update commits the current ordinary cycle beyond its
 * first 50 ms; fresh dash admission waits for the next eligible remainder. */
export function banditOrdinaryCommitted(clock?: BanditRecoveryClock): boolean {
  return !!clock && clock.elapsedMs % intervalMs > frameMs;
}
