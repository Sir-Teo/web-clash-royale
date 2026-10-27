import type { Point, Team } from "./engine";
import { nativeFormationOffset } from "./native-formation";
import { spawnLane } from "./distant-targets";
import source from "./group-formation-data.json" with { type: "json" };

type Profile = { count: number; radius: number; angleShift: number };
/** Physical source lane and account-parity orientation. Guest previews recover
 * canonical X before lane lookup and reflect offsets before caller clamps. */
export function groupFormation(
  card: string,
  center: Point,
  team: Team,
  viewMirrored?: true,
): Point[] | undefined {
  const profile = (source.cards as Record<string, Profile>)[card];
  if (!profile) return;
  const lane = spawnLane(viewMirrored ? 18 - center.x : center.x);
  return Array.from({ length: profile.count }, (_, index) => {
    const offset = nativeFormationOffset(
      index,
      profile.count,
      profile.radius,
      profile.angleShift,
      team === "red",
      lane === 1 ? 1 : 0,
    );
    return {
      x:
        center.x +
        (viewMirrored ? -offset.x : offset.x) / source.sourceUnitsPerTile,
      y: center.y + offset.y / source.sourceUnitsPerTile,
    };
  });
}
