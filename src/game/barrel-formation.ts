import type { Point, Team } from "./engine";
import { nativeFormationOffset } from "./native-formation";
import { spawnLane } from "./distant-targets";
import source from "./barrel-formation-data.json" with { type: "json" };

/** Native factory position requests. The caller applies browser edge clamps;
 * complete native spawn collision adjustment remains a separate policy. */
export function barrelFormation(center: Point, team: Team): Point[] {
  const lane = spawnLane(center.x);
  return Array.from({ length: source.count }, (_, index) => {
    const offset = nativeFormationOffset(
      index,
      source.count,
      source.radius,
      source.angleShift,
      team === "red",
      lane === 1 ? 1 : 0,
    );
    return {
      x: center.x + offset.x / source.sourceUnitsPerTile,
      y: center.y + offset.y / source.sourceUnitsPerTile,
    };
  });
}
