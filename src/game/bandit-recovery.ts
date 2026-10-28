import bandit from "./bandit-data.json" with { type: "json" };

/** Post-landing ordinary clock. Reload uses real time; elapsed uses the
 * integer attack modifier. Rules 52 consume only its first request. */
export interface BanditRecoveryClock {
  elapsedMs: number;
  reloadMs: number;
  carry: number;
  animating?: true;
}

const frameMs = bandit.dash.startup.stepMs;
const frameTime = frameMs / 1000;
const loadMs = bandit.sourceLoadTime * 1000;
const intervalMs = bandit.sourceHitSpeed * 1000;

export function advanceBanditRecovery(
  clock: BanditRecoveryClock,
  step: number,
  rate: number,
  active = true,
): boolean {
  clock.carry = Math.min(frameTime, Math.max(0,
    Number.isFinite(clock.carry) ? clock.carry : 0)) + step;
  while (clock.carry + 1e-8 >= frameTime) {
    clock.carry = Math.max(0, clock.carry - frameTime);
    clock.reloadMs = Math.max(0, clock.reloadMs - frameMs);
    if (!active) continue;
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
