import { CARD_MAP, type CardId } from "./cards";
import { directSpellFlight } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { currentLightningDamage } from "./windup-health";
import { logSpellContains, logSpellProjectile } from "./log-flight";
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
  "log",
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
 * Current Tornado pulls affect pulse membership and projectile contacts. */
export function createLightningFollowup(
  card: CardId,
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
) {
  if (card === "log")
    return createLogLightningFollowup(team, entities, projectiles, areas);
  const rules = CARD_MAP[card];
  const towers = entities.filter(
    (e) => e.team !== team && e.kind === "tower" && e.hp > 0,
  );
  const cache = new Map<string, Map<number, readonly DamagePacket[]>>();
  const moving = areas.some((a) => a.card === "tornado" && a.remaining > 0);
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
    const key = `${moving ? `${point.x},${point.y}/` : ""}${flight ? impactSteps(flight.duration) : 0}:${members.map((e) => e.id).join(",")}`;
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
    const strikes = currentLightningDamage(
      entities,
      proposedAreas,
      proposedShots,
    );
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

/** Only a contact before a remaining friendly pulse can redirect Lightning.
 * Rolling contact time depends on launch Y, while X only selects the lane. */
function createLogLightningFollowup(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
) {
  const clouds = areas.filter(
    (a) => a.card === "lightning" && a.team === team && a.remaining > 0,
  );
  const horizon = Math.max(0, ...clouds.map((a) => impactSteps(a.remaining)));
  const enemies = entities.filter((e) => e.team !== team && e.hp > 0);
  const towers = enemies
    .filter((e) => e.kind === "tower")
    .map((entity) => ({
      entity,
      baseline: [
        ...projectileDamagePackets(entity, projectiles, entities),
        ...poisonDamagePackets(entity, areas),
      ],
    }));
  const blockers = enemies.filter(
    (e) =>
      !e.air &&
      !e.dash &&
      !(e.deploy <= 0 && e.burrow?.phase === "hidden") &&
      clouds.some(
        (a) => Math.hypot(e.x - a.x, e.y - a.y) < a.radius + e.radius,
      ),
  );
  const moving = areas.some((a) => a.card === "tornado" && a.remaining > 0);
  const contacts = new Map<Entity, Map<number, readonly DamagePacket[]>>();
  const cache = new Map<string, Map<number, readonly DamagePacket[]>>();
  let baselineStrikes: ReturnType<typeof currentLightningDamage> | undefined;
  const hitsAt = (entity: Entity, point: Point) => {
    if (!logSpellContains(team, point, entity)) return [];
    let positions = contacts.get(entity);
    if (!positions) {
      positions = new Map();
      contacts.set(entity, positions);
    }
    let hits = positions.get(point.y);
    if (!hits) {
      hits = projectileDamagePackets(
        entity,
        [logSpellProjectile(team, point)],
        entities,
      ).map((hit) => ({ ...hit, order: projectiles.length }));
      positions.set(point.y, hits);
    }
    return hits;
  };
  return (point: Point) => {
    if (moving) {
      const key = `moving:${point.x},${point.y}`;
      const known = cache.get(key);
      if (known) return known;
      const shots = [...projectiles, logSpellProjectile(team, point)];
      const strikes = currentLightningDamage(entities, areas, shots);
      const result = new Map<number, readonly DamagePacket[]>();
      for (const { entity } of towers)
        result.set(entity.id, [
          ...projectileDamagePackets(entity, shots, entities),
          ...poisonDamagePackets(entity, areas),
          ...(strikes.get(entity.id) ?? []),
        ]);
      cache.set(key, result);
      return result;
    }
    const towerHits = towers.map((t) => hitsAt(t.entity, point));
    const early = blockers.flatMap((e) => {
      const hit = hitsAt(e, point)[0];
      return hit && hit.step <= horizon ? [`${e.id}:${hit.step}`] : [];
    });
    const key = `${towerHits.map((hits) => hits[0]?.step ?? 0).join(",")}/${early.join(",")}`;
    const known = cache.get(key);
    if (known) return known;
    const strikes = early.length
      ? currentLightningDamage(entities, areas, [
          ...projectiles,
          logSpellProjectile(team, point),
        ])
      : (baselineStrikes ??= currentLightningDamage(
          entities,
          areas,
          projectiles,
        ));
    const result = new Map<number, readonly DamagePacket[]>();
    towers.forEach((t, i) =>
      result.set(t.entity.id, [
        ...t.baseline,
        ...towerHits[i],
        ...(strikes.get(t.entity.id) ?? []),
      ]),
    );
    cache.set(key, result);
    return result;
  };
}
