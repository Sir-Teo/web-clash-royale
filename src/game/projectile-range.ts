import { combatTraits } from "./combat";
import type { Entity, Point } from "./engine";
import source from "./projectile-range-data.json" with { type: "json" };
export interface RangeFields {
  projectileRadius: number;
  projectileRange: number;
  homing: boolean;
  minimum: number;
  maximum: number;
}
function length(x: number, y: number): number {
  const squared = x * x + y * y;
  return Math.abs(x) > 46340 || Math.abs(y) > 46340 || squared >= 0x7fffffff
    ? 65535
    : Math.floor(Math.sqrt(squared));
}
function normalize(x: number, y: number, bound: number): Point {
  const d = length(x, y);
  return d
    ? { x: Math.trunc((x * bound) / d), y: Math.trunc((y * bound) / d) }
    : { x, y };
}
/** Integer source initialization: direction from caster, bounds from muzzle. */
export function initializeRangeGoal(
  caster: Point | undefined,
  callerStart: Point,
  muzzle: Point,
  requested: Point,
  fields: RangeFields,
): { goal: Point; targetCleared: boolean } {
  const active =
    fields.projectileRadius > 0 && fields.projectileRange > 0 && !fields.homing;
  let goal = { ...requested };
  if (active) {
    const origin = caster ?? callerStart;
    const offset = normalize(
      goal.x - origin.x,
      goal.y - origin.y,
      fields.projectileRange,
    );
    goal = { x: origin.x + offset.x, y: origin.y + offset.y };
  }
  let dx = goal.x - muzzle.x,
    dy = goal.y - muzzle.y;
  if (fields.minimum && length(dx, dy) < fields.minimum)
    ({ x: dx, y: dy } = normalize(dx, dy, fields.minimum));
  if (fields.maximum && length(dx, dy) > fields.maximum)
    ({ x: dx, y: dy } = normalize(dx, dy, fields.maximum));
  return {
    goal: { x: muzzle.x + dx, y: muzzle.y + dy },
    targetCleared: active,
  };
}
export function hasProjectileRange(card: Entity["card"]): boolean {
  return combatTraits({ card }).source in source.ranges;
}
export function projectileRangeEnd(
  body: Entity,
  aim: Point,
  muzzle: Point,
): Point | undefined {
  if (!body.nativeProjectileRange) return;
  const fields = (source.ranges as Record<string, RangeFields>)[
    combatTraits(body).source
  ];
  if (!fields) return;
  const scale = source.sourceUnitsPerTile;
  const point = ({ x, y }: Point) => ({
    x: Math.round(x * scale),
    y: Math.round(y * scale),
  });
  const start = point(muzzle);
  const { goal } = initializeRangeGoal(
    point(body),
    start,
    start,
    point(aim),
    fields,
  );
  return { x: goal.x / scale, y: goal.y / scale };
}
