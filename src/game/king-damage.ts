import { CARD_MAP, type CardId } from "./cards";
import { COMBAT_STEP, directSpellFlight } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import {
  projectileDamagePackets,
  damagePacketOrder,
  impactSteps,
  type DamagePacket,
} from "./projectile-impacts";
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import lightning from "./lightning-data.json" with { type: "json" };
import { lightningStrikes } from "./lightning-strikes";

function poisonPackets(
  target: Entity,
  areas: readonly AreaEffect[],
): DamagePacket[] {
  const clouds = areas
    .filter(
      (a) =>
        a.card === "poison" &&
        a.team !== target.team &&
        a.remaining > 0 &&
        Math.hypot(a.x - target.x, a.y - target.y) < a.radius + target.radius,
    )
    .map((a) => ({ ...a }));
  let status = target.poison ? { ...target.poison } : undefined;
  const horizon = Math.max(
    status?.remaining ?? 0,
    ...clouds.map((a) => a.remaining + poison.buffDuration),
  );
  const packets: DamagePacket[] = [];
  for (
    let step = 1;
    step <= Math.ceil((horizon + COMBAT_STEP) / COMBAT_STEP);
    step++
  ) {
    for (const cloud of clouds) {
      if (cloud.remaining <= 0) continue;
      if (cloud.duration - cloud.remaining + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + poison.areaHitInterval;
        status ??= { remaining: 0, elapsed: 0 };
        status.remaining = poison.buffDuration;
      }
      cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
      if (cloud.remaining < 1e-8) cloud.remaining = 0;
    }
    if (!status) continue;
    status.remaining = Math.max(0, status.remaining - COMBAT_STEP);
    status.elapsed += COMBAT_STEP;
    if (status.elapsed + 1e-8 >= poison.damageInterval) {
      status.elapsed -= poison.damageInterval;
      packets.push({
        step,
        damage: CARD_MAP.poison.damage * poison.crownTowerDamageFraction,
        phase: 0,
        born: 0,
        order: -1,
      });
    }
    if (status.remaining < 1e-8) status = undefined;
  }
  return packets;
}

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
        towerDamageForecast(king, projectiles, areas, entities).baseline,
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
) {
  const shots = projectileDamagePackets(target, projectiles, entities);
  const currentPoison = poisonPackets(target, areas);
  const currentLightning = entities
    ? areas.flatMap((area, order) =>
        area.card === "lightning" &&
        area.team !== target.team &&
        area.remaining > 0
          ? lightningStrikes(area.team, area, entities, area)
              .filter((strike) => strike.entity.id === target.id)
              .map(({ step }): DamagePacket => ({
                step,
                damage:
                  CARD_MAP.lightning.damage *
                  lightning.crownTowerDamageFraction,
                phase: -1,
                born: 0,
                order,
              }))
          : [],
      )
    : [];
  const baseline = [...shots, ...currentPoison, ...currentLightning];
  const cache = new Map<string, DamagePacket[]>();
  return {
    baseline,
    withSpell(card: CardId, team: Team, point: Point): readonly DamagePacket[] {
      const radius = CARD_MAP[card].radius ?? 0;
      if (
        team === target.team ||
        Math.hypot(point.x - target.x, point.y - target.y) >=
          radius + target.radius
      )
        return baseline;
      const strike =
        card === "lightning" && entities
          ? lightningStrikes(team, point, entities).find(
              (hit) => hit.entity.id === target.id,
            )
          : undefined;
      if (card === "lightning" && !strike) return baseline;
      const step =
        strike?.step ??
        (card === "poison"
          ? 0
          : impactSteps(directSpellFlight(card, team, point).duration));
      const key = `${card}:${step}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const packets =
        card === "poison"
          ? poisonPackets(target, [
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
                phase: card === "lightning" ? -1 : 1,
                born: 0,
                order: card === "lightning" ? areas.length : projectiles.length,
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
