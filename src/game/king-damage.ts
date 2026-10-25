import { CARD_MAP, type CardId } from "./cards";
import { directSpellFlight } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import {
  projectileDamagePackets,
  damagePacketOrder,
  impactSteps,
  type DamagePacket,
} from "./projectile-impacts";
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import { createLightningPlan, lightningDamageMap } from "./lightning-strikes";
import { currentLightningDamage } from "./windup-health";
import { logSpellContains, logSpellProjectile } from "./log-flight";
import { poisonDamagePackets } from "./status-health";
export { poisonDamagePackets } from "./status-health";
import {
  createLightningFollowup,
  hasFriendlyLightning,
  isLightningFollowup,
} from "./lightning-followup";

export function kingDeathStep(
  target: Entity,
  packets: readonly DamagePacket[],
): number {
  return towerDamageState(target, packets).deathStep;
}

export function towerDamageState(
  target: Entity,
  packets: readonly DamagePacket[],
  throughStep = Infinity,
) {
  let hp = target.hp,
    shield = target.shield ?? 0;
  if (hp <= 0) return { hp, shield, deathStep: 0 };
  for (const packet of [...packets].sort(damagePacketOrder)) {
    if (packet.step > throughStep) break;
    if (shield > 0) shield = Math.max(0, shield - packet.damage);
    else hp -= packet.damage;
    if (hp <= 0) return { hp, shield, deathStep: packet.step };
  }
  return { hp, shield, deathStep: Infinity };
}

export function launchedKingDeadline(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[] = [],
): number {
  const king = entities.find((e) => e.team === team && e.king && e.hp > 0);
  return king
    ? kingDeathStep(
        king,
        towerDamageForecast(
          king,
          projectiles,
          areas,
          entities,
          currentLightningDamage(entities, areas, projectiles),
        ).baseline,
      )
    : Infinity;
}

/** Cache by arrival step, keeping future damage scans outside the candidate
 * point loop. Poison refreshes one clock; King positions remain stationary. */
export function towerDamageForecast(
  target: Entity,
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  entities?: readonly Entity[],
  lightningPackets?: ReadonlyMap<number, readonly DamagePacket[]>,
) {
  const shots = projectileDamagePackets(target, projectiles, entities);
  const currentPoison = poisonDamagePackets(target, areas);
  const currentLightning = entities
    ? ((
        lightningPackets ?? lightningDamageMap(entities, areas, projectiles)
      ).get(target.id) ?? [])
    : [];
  const withoutLightning = [...shots, ...currentPoison];
  const baseline = [...withoutLightning, ...currentLightning];
  const cache = new Map<string, DamagePacket[]>();
  const lightningCache = new Map<readonly DamagePacket[], DamagePacket[]>();
  const empty: readonly DamagePacket[] = [];
  let lightningPlan: ReturnType<typeof createLightningPlan> | undefined;
  const followups = new Map<
    CardId,
    ReturnType<typeof createLightningFollowup>
  >();
  return {
    baseline,
    withoutLightning,
    withSpell(card: CardId, team: Team, point: Point): readonly DamagePacket[] {
      if (team === target.team) return baseline;
      if (
        entities &&
        isLightningFollowup(card) &&
        hasFriendlyLightning(team, areas)
      ) {
        let forecast = followups.get(card);
        if (!forecast) {
          forecast = createLightningFollowup(
            card,
            team,
            entities,
            projectiles,
            areas,
          );
          followups.set(card, forecast);
        }
        return forecast(point).get(target.id) ?? baseline;
      }
      if (card === "log") {
        if (!logSpellContains(team, point, target)) return baseline;
        const hits = projectileDamagePackets(
          target,
          [logSpellProjectile(team, point)],
          entities,
        );
        if (!hits.length) return baseline;
        const key = `log:${hits[0].step}`;
        let result = cache.get(key);
        if (!result) {
          result = [
            ...baseline,
            ...hits.map((hit) => ({ ...hit, order: projectiles.length })),
          ];
          cache.set(key, result);
        }
        return result;
      }
      if (card === "lightning") {
        if (!entities) return baseline;
        lightningPlan ??= createLightningPlan(
          team,
          entities,
          undefined,
          projectiles,
          areas,
        );
        const hits =
          lightningPlan.project(point).packets.get(target.id) ?? empty;
        let result = lightningCache.get(hits);
        if (!result) {
          result = [...withoutLightning, ...hits];
          lightningCache.set(hits, result);
        }
        return result;
      }
      const radius = CARD_MAP[card].radius ?? 0;
      if (
        Math.hypot(point.x - target.x, point.y - target.y) >=
        radius + target.radius
      )
        return baseline;
      const step =
        card === "poison"
          ? 0
          : impactSteps(directSpellFlight(card, team, point).duration);
      const key = `${card}:${step}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const packets =
        card === "poison"
          ? poisonDamagePackets(target, [
              ...areas,
              {
                id: -1,
                card: "poison",
                team,
                x: point.x,
                y: point.y,
                radius: poison.radius,
                remaining: poison.duration,
                duration: poison.duration,
              },
            ])
          : [
              ...currentPoison,
              {
                step,
                damage:
                  CARD_MAP[card].damage *
                  (card === "rocket" ? rocket.crownTowerDamageFraction : 0.4),
                phase: 1,
                born: 0,
                order: projectiles.length,
              },
            ];
      const result = [...shots, ...currentLightning, ...packets];
      cache.set(key, result);
      return result;
    },
  };
}

export function createKingSpellRace(
  card: CardId,
  team: Team,
  target: Entity,
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  entities?: readonly Entity[],
) {
  const forecast = towerDamageForecast(target, projectiles, areas, entities);
  const cache = new Map<readonly DamagePacket[], number>();
  const death = (packets: readonly DamagePacket[]) => {
    let step = cache.get(packets);
    if (step === undefined) {
      step = kingDeathStep(target, packets);
      cache.set(packets, step);
    }
    return step;
  };
  return {
    baseline: death(forecast.baseline),
    stepAt: (point: Point) => death(forecast.withSpell(card, team, point)),
  };
}

export const kingRacePriority = (step: number, deadline: number) =>
  step < deadline ? 10_000 : step === deadline ? 9_500 : 8_000;
