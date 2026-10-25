import type { AreaEffect, Entity, Projectile, Team } from "./engine";
import { poisonDamagePackets } from "./king-damage";
import { currentLightningDamage } from "./windup-health";
import {
  damagePacketOrder,
  impactSteps,
  projectileDamagePackets,
} from "./projectile-impacts";
import { createSpellPullPaths } from "./spell-pull-paths";
import log from "./log-data.json" with { type: "json" };

/** One read-only reservation context per decision. Lightning selects against
 * the whole board once; per-body packet/shield work is cached on first use. */
export function createSpellDamageReservation(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
) {
  const shots = projectiles.filter(
    (p) => p.team === team && p.source === 0 && p.damage > 0 && p.remaining > 0,
  );
  const friendlyAreas = areas.filter((a) => a.team === team);
  const pulls = areas.filter((a) => a.card === "tornado" && a.remaining > 0);
  // Cover each complete released trajectory, including delayed flights and
  // the rolling child of a Log launch. This is longer than a current windup.
  const horizon =
    pulls.length && shots.length
      ? Math.max(
          ...shots.map((p) => {
            const flight =
              p.speed && p.flight
                ? Math.hypot(p.tx - p.flight.x, p.ty - p.flight.y) / p.speed
                : p.remaining;
            return (
              impactSteps(flight) +
              (p.delay && p.delay > 1e-8 ? impactSteps(p.delay) : 0) +
              (p.style === "log-launch"
                ? impactSteps(log.rollingRange / log.rollingSpeed)
                : 0) +
              3
            );
          }),
        )
      : 0;
  const pullPath = createSpellPullPaths(areas, horizon);
  const strikes = currentLightningDamage(entities, areas, projectiles);
  const cache = new Map<Entity, number>();
  return (entity: Entity): number => {
    if (
      entity.team === team ||
      entity.hp <= 0 ||
      entity.dash ||
      (entity.deploy <= 0 && entity.burrow?.phase === "hidden")
    )
      return 0;
    const known = cache.get(entity);
    if (known !== undefined) return known;
    const packets = [
      ...projectileDamagePackets(entity, shots, entities, pullPath?.(entity)),
      // Moving troops can leave a cloud. Reserve their already applied status,
      // while structures keep the stationary, non-stacking cloud timeline.
      ...poisonDamagePackets(
        entity,
        entity.kind === "troop" ? [] : friendlyAreas,
      ),
      ...(strikes.get(entity.id) ?? []),
    ].sort(damagePacketOrder);
    let shield = entity.shield ?? 0,
      reserved = 0;
    for (const packet of packets) {
      if (shield > 0) {
        const absorbed = Math.min(shield, packet.damage);
        shield -= absorbed;
        reserved += absorbed;
      } else reserved += packet.damage;
    }
    cache.set(entity, reserved);
    return reserved;
  };
}

export function pendingSpellDamage(
  entity: Entity,
  team: Team,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
  entities?: readonly Entity[],
): number {
  // Without board context, a Lightning target's rank cannot be established.
  return createSpellDamageReservation(
    team,
    entities ?? [entity],
    projectiles,
    entities ? areas : areas.filter((a) => a.card !== "lightning"),
  )(entity);
}
