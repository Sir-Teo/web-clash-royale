import type { Entity } from "./engine";
import { attackRadius } from "./attack-range";
import { combatTraits } from "./combat";
import { acquisitionSight } from "./sight-range";
import { comparePrimaryScores, primaryTargetScore } from "./primary-score";
import score from "./primary-score-data.json" with { type: "json" };
import source from "./primary-geometry-data.json" with { type: "json" };

type Viewer = Pick<
  Entity,
  | "card"
  | "king"
  | "team"
  | "x"
  | "y"
  | "radius"
  | "range"
  | "sightRange"
  | "rangeRadiusFactor"
  | "minimumRange"
  | "nativePrimaryScore"
  | "nativePrimaryGeometry"
>;
type Candidate = Pick<
  Entity,
  "x" | "y" | "radius" | "kind" | "targetScoreBias"
>;
const squared = (value: number) => (value * score.sourceUnitsPerTile) ** 2;

/** Fresh candidate geometry only. Health/team/air eligibility, existing locks
 * and distant fallback remain the caller's separate policies. */
export function primaryCandidateVisible(viewer: Viewer, target: Candidate) {
  const sight = acquisitionSight(viewer);
  if (!viewer.nativePrimaryGeometry)
    return (
      Math.hypot(viewer.x - target.x, viewer.y - target.y) <=
      sight + target.radius
    );
  const profile =
    source.profiles[
      combatTraits(viewer).source as keyof typeof source.profiles
    ];
  const extra =
    target.kind === "tower"
      ? source.crownSightExtra
      : target.kind === "building"
        ? source.buildingSightExtra
        : 0;
  const reach = sight + target.radius + extra;
  const adjusted = primaryTargetScore(viewer, target);
  const minimum = viewer.minimumRange ?? 0;
  if (minimum > 0) {
    const inner =
      viewer.rangeRadiusFactor === 0
        ? minimum
        : Math.abs(minimum + attackRadius(viewer) - target.radius);
    if (comparePrimaryScores(viewer, adjusted, squared(inner)) < 0)
      return false;
  }
  if (comparePrimaryScores(viewer, adjusted, squared(reach)) > 0) return false;
  const dx = target.x - viewer.x,
    dy = target.y - viewer.y;
  const behind = viewer.team === "blue" ? dy : -dy;
  // Translation noise is far below one native coordinate unit (0.001 tile).
  if (profile.rear > 0 && behind > Math.max(0, reach - profile.rear) + 1e-9)
    return false;
  if (
    profile.side > 0 &&
    Math.abs(dx) > Math.max(0, reach - profile.side) + 1e-9
  )
    return false;
  return true;
}
