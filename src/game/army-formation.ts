import type { Point, Team } from "./engine";
import { nativeFormationOffset } from "./native-formation";
import source from "./army-formation-data.json" with { type: "json" };

/** Fifteen-body native requests before caller clamps/collision separation.
 * View rotation reflects X before clamping, preserving guest edge previews. */
export function armyFormation(
  center: Point,
  team: Team,
  viewMirrored?: true,
): Point[] {
  return Array.from({ length: source.count }, (_, index) => {
    const offset = nativeFormationOffset(
      index,
      source.count,
      source.radius,
      source.angleShift,
      team === "red",
      0,
    );
    return {
      x:
        center.x +
        (viewMirrored ? -offset.x : offset.x) / source.sourceUnitsPerTile,
      y: center.y + offset.y / source.sourceUnitsPerTile,
    };
  });
}
