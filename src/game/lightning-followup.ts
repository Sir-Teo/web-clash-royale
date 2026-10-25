import { CARD_MAP, type CardId } from "./cards";
import { directSpellFlight } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { lightningDamageMap } from "./lightning-strikes";
import {
  impactSteps,
  projectileDamagePackets,
  type DamagePacket,
} from "./projectile-impacts";
import { poisonDamagePackets } from "./status-health";
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };

const FOLLOWUPS = new Set<CardId>([
  "zap",
  "fireball",
  "arrows",
  "rocket",
  "poison",
]);
export const isLightningFollowup = (card: CardId) => FOLLOWUPS.has(card);
export const hasFriendlyLightning = (
  team: Team,
  areas: readonly AreaEffect[],
) =>
  areas.some(
    (a) => a.card === "lightning" && a.team === team && a.remaining > 0,
  );

/** A proposed current-rule spell can redirect an existing Lightning pulse.
 * Cache equivalent affected bodies and impact steps, holding positions fixed. */
export function createLightningFollowup(
  card: CardId,
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
) {
  const rules = CARD_MAP[card];
  const towers = entities.filter(
    (e) => e.team !== team && e.kind === "tower" && e.hp > 0,
  );
  const cache = new Map<string, Map<number, readonly DamagePacket[]>>();
  return (point: Point) => {
    const flight =
      card === "poison" ? undefined : directSpellFlight(card, team, point);
    const members = entities.filter(
      (e) =>
        e.hp > 0 &&
        e.team !== team &&
        (!e.air || rules.hitsAir) &&
        Math.hypot(e.x - point.x, e.y - point.y) <
          (rules.radius ?? 0) + e.radius,
    );
    const key = `${flight ? impactSteps(flight.duration) : 0}:${members.map((e) => e.id).join(",")}`;
    const known = cache.get(key);
    if (known) return known;
    const proposedShots: readonly Projectile[] = flight
      ? [
          ...projectiles,
          {
            id: -1,
            team,
            source: 0,
            x: flight.origin.x,
            y: flight.origin.y,
            tx: point.x,
            ty: point.y,
            target: null,
            damage: rules.damage,
            remaining: flight.duration,
            duration: flight.duration,
            splash: rules.radius ?? 0,
            air: !!rules.hitsAir,
            style: card,
            stun: 0,
            towerDamageFraction:
              card === "rocket" ? rocket.crownTowerDamageFraction : 0.4,
          },
        ]
      : projectiles;
    const proposedAreas: readonly AreaEffect[] =
      card === "poison"
        ? [
            ...areas,
            {
              id: -1,
              card: "poison",
              team,
              x: point.x,
              y: point.y,
              radius: poison.radius,
              duration: poison.duration,
              remaining: poison.duration,
            },
          ]
        : areas;
    const strikes = lightningDamageMap(entities, proposedAreas, proposedShots);
    const result = new Map<number, readonly DamagePacket[]>();
    for (const tower of towers)
      result.set(tower.id, [
        ...projectileDamagePackets(tower, proposedShots, entities),
        ...poisonDamagePackets(tower, proposedAreas),
        ...(strikes.get(tower.id) ?? []),
      ]);
    cache.set(key, result);
    return result;
  };
}
