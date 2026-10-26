import native from "./attack-range-data.json" with { type: "json" };

interface AttackBody {
  radius: number;
  /** Resolved range geometry travels with snapshots and projected bodies. */
  rangeRadiusFactor?: number;
}

export const NATIVE_RANGE_RADIUS_FACTOR = native.ownRadiusFactor;

/** Missing geometry retains earlier recordings' original arithmetic. */
export const attackRadius = (body: AttackBody) =>
  body.radius * (body.rangeRadiusFactor ?? 0.35);

export const attackReach = (
  body: AttackBody & { range: number },
  target: { radius: number },
) => body.range + target.radius + attackRadius(body);
