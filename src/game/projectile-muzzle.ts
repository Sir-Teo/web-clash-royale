import { combatTraits } from "./combat";
import type { Entity, Point } from "./engine";
import source from "./projectile-muzzle-data.json" with { type: "json" };
export interface MuzzleFields {
  radius: number;
  z: number;
  y: number;
  constantHeight?: number;
}
/** Native integer normalization after projecting browser XY to source units. */
export function launchPoint(
  actor: Point & { z: number; owner: number },
  target: Point,
  fields: MuzzleFields,
): Point & { z: number } {
  const scale = source.sourceUnitsPerTile;
  const x = Math.round(actor.x * scale),
    y = Math.round(actor.y * scale);
  const dx = Math.round(target.x * scale) - x,
    dy = Math.round(target.y * scale) - y;
  const distance = Math.floor(Math.sqrt(dx * dx + dy * dy));
  return {
    x:
      (x + (distance ? Math.trunc((dx * fields.radius) / distance) : dx)) /
      scale,
    y:
      (y +
        (distance ? Math.trunc((dy * fields.radius) / distance) : dy) +
        (actor.owner === 0 ? fields.y : -fields.y)) /
      scale,
    z: actor.z + fields.z / scale,
  };
}
export function hasProjectileMuzzle(
  card: Entity["card"],
  king?: boolean,
): boolean {
  return combatTraits({ card, king }).source in source.muzzles;
}
/** Z is a source offset; callers add their existing rendered body height. */
export function projectileMuzzle(body: Entity, target: Point) {
  if (!body.nativeProjectileMuzzle) return;
  const fields = (source.muzzles as Record<string, MuzzleFields>)[
    combatTraits(body).source
  ];
  if (!fields) return;
  return launchPoint(
    { x: body.x, y: body.y, z: 0, owner: source.ownerForTeam[body.team] },
    target,
    fields,
  );
}

/** The later native initializer replaces Z absolutely when configured. */
export function muzzleHeight(bodyHeight: number, fields: MuzzleFields): number {
  return fields.constantHeight
    ? fields.constantHeight / source.sourceUnitsPerTile
    : bodyHeight + fields.z / source.sourceUnitsPerTile;
}
export function projectileMuzzleHeight(body: Entity, bodyHeight: number) {
  if (!body.nativeProjectileMuzzle) return;
  const fields = (source.muzzles as Record<string, MuzzleFields>)[
    combatTraits(body).source
  ];
  return fields ? muzzleHeight(bodyHeight, fields) : undefined;
}
