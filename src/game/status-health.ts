import { poisonTickDamage } from "./poison-damage";
import { COMBAT_STEP, HEAL_PER_TICK } from "./combat";
import type { AreaEffect, Entity, Projectile } from "./engine";
import {
  projectileDamagePackets,
  damagePacketOrder,
  type DamagePacket,
} from "./projectile-impacts";
import poison from "./poison-data.json" with { type: "json" };
import heal from "./heal-data.json" with { type: "json" };

export interface HealthPacket extends DamagePacket {
  healing?: boolean;
  bypassShield?: boolean;
  bypassHidden?: boolean;
  bypassDash?: boolean;
}

/** Released damage and current status clocks at fixed positions. */
export function healthPackets(
  target: Entity,
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  entities: readonly Entity[],
  horizon: number,
): HealthPacket[] {
  const packets: HealthPacket[] = [
    ...projectileDamagePackets(target, projectiles, entities),
    ...poisonDamagePackets(target, areas),
  ];
  const clouds =
    target.kind === "troop"
      ? areas
          .filter(
            (a) =>
              a.card === "heal" &&
              a.team === target.team &&
              a.remaining > 0 &&
              Math.hypot(a.x - target.x, a.y - target.y) <
                a.radius + target.radius,
          )
          .map((a) => ({ ...a }))
      : [];
  let status = target.heal ? { ...target.heal } : undefined;
  let deploy = target.deploy;
  const last = Math.ceil((horizon - 1e-8) / COMBAT_STEP);
  for (let step = 1; step <= last; step++) {
    for (const cloud of clouds) {
      if (cloud.remaining <= 0) continue;
      if (cloud.duration - cloud.remaining + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + heal.areaHitInterval;
        status ??= { remaining: 0, elapsed: 0 };
        status.remaining = heal.buffDuration;
      }
      cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
      if (cloud.remaining < 1e-8) cloud.remaining = 0;
    }
    if (status) {
      status.remaining = Math.max(0, status.remaining - COMBAT_STEP);
      status.elapsed += COMBAT_STEP;
      if (status.elapsed + 1e-8 >= heal.healInterval) {
        status.elapsed -= heal.healInterval;
        packets.push({
          step,
          damage: HEAL_PER_TICK,
          healing: true,
          phase: -0.5,
          born: 0,
          order: -1,
        });
      }
      if (status.remaining < 1e-8) status = undefined;
    }
    if (deploy > 0) deploy -= COMBAT_STEP;
    else if (target.lifetime)
      packets.push({
        step,
        damage: (target.maxHp / target.lifetime) * COMBAT_STEP,
        bypassShield: true,
        phase: 0.5,
        born: 0,
        order: -1,
      });
  }
  return packets.filter((p) => p.step <= last).sort(damagePacketOrder);
}

export function poisonDamagePackets(
  target: Entity,
  areas: readonly AreaEffect[],
): HealthPacket[] {
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
  let deploy = target.deploy;
  const horizon = Math.max(
    status?.remaining ?? 0,
    ...clouds.map((a) => a.remaining + poison.buffDuration),
  );
  const packets: HealthPacket[] = [];
  for (
    let step = 1;
    step <= Math.ceil((horizon + COMBAT_STEP) / COMBAT_STEP);
    step++
  ) {
    for (const cloud of clouds) {
      if (cloud.remaining <= 0) continue;
      if (cloud.duration - cloud.remaining + 1e-8 >= (cloud.hitAt ?? 0)) {
        cloud.hitAt = (cloud.hitAt ?? 0) + poison.areaHitInterval;
        if (
          !target.nativeRetainedPoison ||
          deploy > 0 ||
          target.burrow?.phase !== "hidden"
        ) {
          status ??= { remaining: 0, elapsed: 0 };
          status.remaining = poison.buffDuration;
        }
      }
      cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
      if (cloud.remaining < 1e-8) cloud.remaining = 0;
    }
    if (!status) {
      if (deploy > 0) deploy -= COMBAT_STEP;
      continue;
    }
    status.remaining = Math.max(0, status.remaining - COMBAT_STEP);
    status.elapsed += COMBAT_STEP;
    if (status.elapsed + 1e-8 >= poison.damageInterval) {
      status.elapsed -= poison.damageInterval;
      packets.push({
        step,
        damage: poisonTickDamage(target),
        phase: 0,
        born: 0,
        order: -1,
        ...(target.nativeRetainedPoison ? { bypassHidden: true } : {}),
        ...(target.nativeBanditDash ? { bypassDash: true } : {}),
      });
    }
    if (status.remaining < 1e-8) status = undefined;
    if (deploy > 0) deploy -= COMBAT_STEP;
  }
  return packets;
}
