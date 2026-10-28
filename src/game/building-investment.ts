import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";

/** Include the opposite river bank before a push enters the defended half. */
export function approachingBuildingThreat(
  team: Team,
  entities: readonly Entity[],
) {
  return entities.some(
    (entity) =>
      entity.team !== team &&
      entity.kind === "troop" &&
      entity.hp > 0 &&
      (team === "red" ? entity.y <= 18 : entity.y >= 14),
  );
}

/** Known hostile effects that can damage or interrupt a new building. */
export function buildingSpellDanger(
  point: Point,
  radius: number,
  team: Team,
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
) {
  const distance = (other: Point) =>
    Math.hypot(point.x - other.x, point.y - other.y);
  return (
    projectiles.some(
      (projectile) =>
        projectile.team !== team &&
        !projectile.decorative &&
        projectile.remaining >= 0 &&
        projectile.splash > 0 &&
        (projectile.damage > 0 || projectile.stun > 0) &&
        distance({ x: projectile.tx, y: projectile.ty }) <=
          projectile.splash + radius,
    ) ||
    areas.some(
      (area) =>
        area.team !== team &&
        area.remaining > 0 &&
        ["freeze", "poison", "graveyard", "lightning"].includes(area.card) &&
        distance(area) <= area.radius + radius,
    )
  );
}
