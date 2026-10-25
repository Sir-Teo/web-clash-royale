import type { Entity, Point } from "./engine";
import { COMBAT_STEP } from "./combat";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import darkPrince from "./dark-prince-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
type MovingBody = Pick<
  Entity,
  "x" | "y" | "air" | "card" | "speed" | "rage" | "slow" | "move"
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
    (e.card === "prince" && e.move > 2.3
      ? 1.8
      : e.card === "dark-prince" && e.move > darkPrince.chargeRange
        ? darkPrince.chargeSpeedMultiplier
        : e.card === "battle-ram" && e.move > battleRam.chargeRange
          ? battleRam.chargeSpeedMultiplier
          : 1);
  const move = Math.min(d, speed * COMBAT_STEP);
  e.x = clamp(e.x + (dx / d) * move, 0.5, 17.5);
  e.y = clamp(e.y + (dy / d) * move, 0.6, 31.4);
  e.move += COMBAT_STEP;
}
