import type { Entity, Point } from "./engine";
import { attackReach } from "./attack-range";
import { launchPoint } from "./projectile-muzzle";
import bandit from "./bandit-data.json" with { type: "json" };

/** Host entity policy preserves historical travel through guest snapshots. */
export function banditDashSpeed(entity: Pick<Entity, "nativeBanditDash">) {
  return entity.nativeBanditDash ? bandit.dash.speed : bandit.dash.legacySpeed;
}

type DashBody = Point & Pick<Entity, "range" | "radius" | "rangeRadiusFactor">;
type DashTarget = Point & Pick<Entity, "radius" | "dash">;
const targetRadius = (target: DashTarget) => target.dash ? 0 : target.radius;

/** The native launch stores a tile destination before entering the dash state. */
export function banditDashGoal(actor: DashBody, target: DashTarget): Point {
  const p = bandit.dash.goal;
  const front = launchPoint({ ...target, z: 0, owner: 0 }, actor, {
    radius: Math.round((actor.radius + targetRadius(target)) * p.unitsPerTile), z: 0, y: 0,
  });
  const tile = p.tileUnits / p.unitsPerTile;
  return { x: (Math.trunc(front.x / tile) + 0.5) * tile,
    y: (Math.trunc(front.y / tile) + 0.5) * tile };
}

/** One native 50-ms movement frame; the caller provides its world bounds. */
export function banditGoalFrame(
  actor: DashBody,
  goal: Point,
  target: DashTarget | undefined,
  move: (point: Point) => Point = (point) => point,
) {
  const p = bandit.dash.goal, scale = p.unitsPerTile;
  let x = Math.round(actor.x * scale), y = Math.round(actor.y * scale);
  const gx = Math.round(goal.x * scale), gy = Math.round(goal.y * scale);
  const tx = target ? Math.round(target.x * scale) : 0,
    ty = target ? Math.round(target.y * scale) : 0;
  const reach = target ? Math.round(attackReach(actor, { radius: targetRadius(target) }) * scale) : 0;
  let landed = false;
  for (const chunk of [p.chunkUnits, p.chunkUnits, 0]) {
    const dx = gx - x, dy = gy - y;
    const distance = Math.max(1, Math.floor(Math.hypot(dx, dy)));
    const travel = Math.min(chunk, distance);
    const mx = Math.trunc(Math.trunc(dx * p.headingScale / distance) * travel / p.headingScale),
      my = Math.trunc(Math.trunc(dy * p.headingScale / distance) * travel / p.headingScale);
    const next = move({ x: (x + mx) / scale, y: (y + my) / scale });
    x = Math.round(next.x * scale); y = Math.round(next.y * scale);
    landed = (!!target && (x - tx) ** 2 + (y - ty) ** 2 <= reach ** 2) ||
      Math.trunc(Math.floor(Math.hypot(gx - x, gy - y)) / p.unitsPerStep) === 0;
    if (landed) break;
  }
  return { x: x / scale, y: y / scale, landed,
    hit: landed && !!target && (x - tx) ** 2 + (y - ty) ** 2 <= (reach + p.landingExtensionUnits) ** 2 };
}
