import { COMBAT_STEP, combatTraits } from "./combat";
import { projectileRangeEnd } from "./projectile-range";
import { projectileMuzzle } from "./projectile-muzzle";
import type { Entity, Point } from "./engine";
import bowler from "./bowler-data.json" with { type: "json" };
import executioner from "./executioner-data.json" with { type: "json" };
import sparky from "./sparky-data.json" with { type: "json" };
import xBow from "./x-bow-data.json" with { type: "json" };

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export interface AttackFlight {
  start: Point;
  end: Point;
  speed: number | undefined;
  duration: number;
  contactRadius?: number;
}

/** Existing launch geometry, shared by combat and stationary-target forecasts. */
export function attackFlight(
  attacker: Entity,
  target: Point,
): AttackFlight | undefined {
  const muzzle = projectileMuzzle(attacker, target);
  const dx = target.x - attacker.x,
    dy = target.y - attacker.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance,
    uy = dy / distance;
  if (attacker.card === "bowler" || attacker.card === "executioner") {
    const boulder = attacker.card === "bowler";
    const projectile = boulder ? bowler.projectile : executioner.projectile;
    const offset = boulder ? 1 : 0.6;
    const start = muzzle
      ? { x: muzzle.x, y: muzzle.y }
      : { x: attacker.x + ux * offset, y: attacker.y + uy * offset };
    const reach = boulder
      ? offset + bowler.projectile.range
      : clamp(
          distance + 2,
          executioner.projectile.minDistance,
          executioner.projectile.range,
        );
    const end =
      projectileRangeEnd(attacker, target, start) ??
      (boulder
        ? {
            x: clamp(start.x + ux * bowler.projectile.range, 0.5, 17.5),
            y: clamp(start.y + uy * bowler.projectile.range, 0.6, 31.4),
          }
        : {
            x: clamp(attacker.x + ux * reach, 0.5, 17.5),
            y: clamp(attacker.y + uy * reach, 0.6, 31.4),
          });
    return {
      start,
      end,
      speed: projectile.speed,
      duration: Math.hypot(end.x - start.x, end.y - start.y) / projectile.speed,
      contactRadius: projectile.radius,
    };
  }
  const projectile = combatTraits(attacker).projectile;
  if (!projectile && attacker.card !== "balloon" && attacker.card !== "tesla")
    return;
  const offset =
    attacker.card === "sparky"
      ? sparky.projectileStart.radius
      : attacker.card === "x-bow"
        ? xBow.projectileStartRadius
        : 0;
  const start = muzzle
    ? { x: muzzle.x, y: muzzle.y }
    : { x: attacker.x + ux * offset, y: attacker.y + uy * offset };
  const end = { x: target.x, y: target.y };
  const speed =
    attacker.card === "sparky"
      ? sparky.projectile.speed
      : (projectile?.speed ?? (attacker.card === "tesla" ? 1000 : undefined));
  return {
    start,
    end,
    speed,
    duration: speed
      ? Math.max(
          COMBAT_STEP,
          Math.hypot(start.x - end.x, start.y - end.y) / speed,
        )
      : 0.35,
  };
}
