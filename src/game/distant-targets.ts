import type { Entity, Point } from "./engine";
import source from "./distant-target-data.json" with { type: "json" };

export type NativeLane = 0 | 1 | 2;
type Actor = Point & Pick<Entity, "nativeLane" | "nativeDistantMirrored">;

// These tolerances only absorb browser coordinate translation noise, far below
// one source coordinate or score unit. They do not quantize world movement.
const sourceInteger = (value: number) => {
  const integer = Math.round(value);
  return Math.abs(value - integer) <= 1e-7 ? integer : value;
};
const cell = (coordinate: number) =>
  Math.trunc(sourceInteger(coordinate) / source.sourceUnitsPerCell);
const laneAt = (column: number): NativeLane =>
  column < source.gridWidth / 2 ? 1 : 2;

/** Both archived maps have exactly mirrored positive lane cells confined to
 * their respective X halves. Their nearest-lane search reduces to this half
 * test at every Y. Undefined hint means the native -1 sentinel. */
export function spawnLane(
  x: number,
  hintX?: number,
  mirrored?: true,
): NativeLane {
  const sx = sourceInteger((mirrored ? 18 - x : x) * source.sourceUnitsPerTile);
  let lane = laneAt(cell(sx));
  if (hintX !== undefined) {
    const hint = sourceInteger(
      (mirrored ? 18 - hintX : hintX) * source.sourceUnitsPerTile,
    );
    const hx = cell(hint),
      gx5 = cell(sx + source.hintXBias);
    const middle = source.gridWidth / 2;
    const crossed =
      (hint < sx && hx < middle && gx5 >= middle) ||
      (hint > sx && hx > middle && gx5 <= middle);
    if (crossed && lane === laneAt(hx)) lane = (3 - lane) as NativeLane;
  }
  return mirrored ? ((3 - lane) as NativeLane) : lane;
}

export function distantTargetScore(
  actor: Actor,
  target: Point & Pick<Entity, "nativeLane">,
) {
  const dx = sourceInteger(
    Math.abs(actor.x - target.x) * source.sourceUnitsPerTile,
  );
  const dy = sourceInteger(
    Math.abs(actor.y - target.y) * source.sourceUnitsPerTile,
  );
  const distance =
    Math.max(dx, dy) +
    Math.floor(
      sourceInteger(
        (Math.min(dx, dy) * source.distanceNumerator) /
          source.distanceDenominator,
      ),
    );
  // Keep the host's quantized boundary side after a guest's 180-degree view
  // rotation: truncation at exact half-cell boundaries is not symmetric.
  const y = actor.nativeDistantMirrored ? 32 - actor.y : actor.y;
  const gridY = cell(y * source.sourceUnitsPerTile);
  const bias =
    actor.nativeLane === target.nativeLane
      ? gridY >= source.boundaryCells &&
        gridY < source.gridHeight - source.boundaryCells
        ? source.interiorLaneBias
        : source.boundaryLaneBias
      : 0;
  return distance * distance - 2 * distance * bias - bias * bias;
}

/** Archived two-account regular arena: seed with the opposing King, then
 * consider alive Princess Towers in collection order. The caller separately
 * applies common eligibility and nearby acquisition/retained-lock policies. */
export function distantTarget(
  actor: Actor & Pick<Entity, "team">,
  entities: readonly Entity[],
) {
  let winner = entities.find(
    (body) => body.team !== actor.team && body.kind === "tower" && body.king,
  );
  if (!winner) return;
  const dx = (actor.x - winner.x) * source.sourceUnitsPerTile;
  const dy = (actor.y - winner.y) * source.sourceUnitsPerTile;
  let score = dx * dx + dy * dy;
  const princesses = entities.filter(
    (body) =>
      body.team !== actor.team &&
      body.kind === "tower" &&
      !body.king &&
      body.hp > 0,
  );
  const partial = princesses.length < source.expectedPrincesses;
  for (const target of princesses) {
    const candidateScore = distantTargetScore(actor, target);
    if (
      candidateScore < score - 1e-4 &&
      (!partial || target.nativeLane === actor.nativeLane)
    ) {
      winner = target;
      score = candidateScore;
    }
  }
  return winner;
}
