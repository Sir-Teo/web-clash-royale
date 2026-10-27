import { areaRandomSeed } from "./area-random";
import { combatTraits } from "./combat";
import type { Entity, Point } from "./engine";
import data from "./projectile-volley-data.json" with { type: "json" };
export interface VolleyFields {
  count: number;
  areaRadius: number;
}
/** Integer source offsets, including the custom first projectile at the center. */
export function volleyOffsets(
  fields: VolleyFields,
  boundedRandom: (upperExclusive: number) => number,
): Point[] {
  const count = Math.max(1, fields.count);
  const quarter = fields.areaRadius >> 2;
  const step = Math.floor(360 / count);
  return Array.from({ length: count }, (_, index) => {
    if (!index) return { x: 0, y: 0 };
    const radius = quarter + boundedRandom(fields.areaRadius - quarter);
    const angle = (index * step * Math.PI) / 180;
    return {
      x: Math.trunc((radius * Math.round(Math.cos(angle) * 1024)) / 1024),
      y: Math.trunc((radius * Math.round(Math.sin(angle) * 1024)) / 1024),
    };
  });
}
export function hasProjectileVolley(card: Entity["card"]): boolean {
  return combatTraits({ card }).source in data.volleys;
}
/** Persist a combat-only stream so recorded AI actions reproduce every arrow. */
export function volleyRandom(body: Entity, seed: number): number {
  body.volleyRandomState =
    (Math.imul(
      1664525,
      body.volleyRandomState ?? areaRandomSeed(seed, body.id),
    ) +
      1013904223) >>>
    0;
  return body.volleyRandomState / 4294967296;
}
/** The native RNG stream is unknown; callers supply deterministic samples. */
export function projectileVolley(
  body: Entity,
  aim: Point,
  boundedRandom: (upperExclusive: number) => number,
): Point[] | undefined {
  if (!body.nativeProjectileVolley) return;
  const fields = (data.volleys as Record<string, VolleyFields>)[
    combatTraits(body).source
  ];
  return fields
    ? volleyOffsets(fields, boundedRandom).map(({ x, y }) => ({
        x: aim.x + x / data.sourceUnitsPerTile,
        y: aim.y + y / data.sourceUnitsPerTile,
      }))
    : undefined;
}
