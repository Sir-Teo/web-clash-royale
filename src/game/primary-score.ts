import type { Entity, Point } from "./engine";
import source from "./primary-score-data.json" with { type: "json" };

type Actor = Point & Pick<Entity, "nativePrimaryScore">;
type Target = Point & Pick<Entity, "radius" | "targetScoreBias">;

/** Source score units are squared thousandths of a tile. Eligibility, sight,
 * retention and distant fallback remain the caller's separate policies. */
export function primaryTargetScore(actor: Actor, target: Target) {
  if (!actor.nativePrimaryScore)
    return Math.hypot(actor.x - target.x, actor.y - target.y) - target.radius;
  const dx = (actor.x - target.x) * source.sourceUnitsPerTile;
  const dy = (actor.y - target.y) * source.sourceUnitsPerTile;
  return Math.max(0, dx * dx + dy * dy - (target.targetScoreBias ?? 0));
}

/** Below one native squared-distance unit, absorb coordinate translation's
 * floating-point noise so exact source-score ties retain collection order. */
export function comparePrimaryScores(
  actor: Pick<Entity, "nativePrimaryScore">,
  left: number,
  right: number,
) {
  const difference = left - right;
  return actor.nativePrimaryScore && Math.abs(difference) <= 1e-4
    ? 0
    : difference;
}

export function comparePrimaryTargets(
  actor: Actor,
  left: Target,
  right: Target,
) {
  return comparePrimaryScores(
    actor,
    primaryTargetScore(actor, left),
    primaryTargetScore(actor, right),
  );
}

export const barrelTargetScoreBias = (index: number) =>
  source.barrelScoreBias[index];
