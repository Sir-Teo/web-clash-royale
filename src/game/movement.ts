import type { Entity, Point } from "./engine";
import { COMBAT_STEP } from "./combat";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import { chargeRange, chargeSpeedMultiplier } from "./charge";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
type MovingBody = Pick<
  Entity,
  "x" | "y" | "air" | "card" | "speed" | "rage" | "slow" | "move" | "chargeDistance"
>;

/** One native movement step, including bridge routing and charge speed. */
export function advanceMovement(e: MovingBody, target: Point) {
  let x = target.x,
    y = target.y;
  const crossing =
    (e.y < 14.8 && target.y > 16) ||
    (e.y > 17.2 && target.y < 16) ||
    (e.y >= 14.8 && e.y <= 17.2);
  if (crossing && !e.air && e.card !== "hog-rider") {
    const bridge = e.x < 9 ? 4 : 14;
    x = bridge;
    y =
      target.y < e.y ? (e.y > 17.2 ? 17.15 : 14.6) : e.y < 14.8 ? 14.85 : 17.4;
  }
  const dx = x - e.x,
    dy = y - e.y,
    d = Math.hypot(dx, dy);
  if (d < 0.001) return;
  const speed =
    e.speed *
    (e.rage ? rage.speedMultiplier : 1) *
    (e.slow ? iceWizard.speedMultiplier : 1) *
    chargeSpeedMultiplier(e);
  const move = Math.min(d, speed * COMBAT_STEP);
  const oldX = e.x, oldY = e.y;
  e.x = clamp(e.x + (dx / d) * move, 0.5, 17.5);
  e.y = clamp(e.y + (dy / d) * move, 0.6, 31.4);
  e.move += COMBAT_STEP;
  if (e.chargeDistance !== undefined) {
    const range = chargeRange(e.card);
    const distance = e.chargeDistance + Math.hypot(e.x - oldX, e.y - oldY);
    // Keep travel beyond readiness so coalesced frames can locate the crossing.
    e.chargeDistance = Math.abs(distance - range) < 1e-8 ? range : distance;
  }
}
