import type { CardId } from "./cards";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { createKingSpellRace } from "./king-damage";

/** Can this proposed finisher, together with already visible spell damage,
 * defeat the stationary enemy King strictly before the fatal impact step? */
export function finishesKingBefore(
  card: CardId,
  team: Team,
  target: Entity,
  point: Point,
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  deadline: number,
  entities?: readonly Entity[],
): boolean {
  return (
    !Number.isFinite(deadline) ||
    createKingSpellRace(
      card,
      team,
      target,
      projectiles,
      areas,
      entities,
    ).stepAt(point) < deadline
  );
}
