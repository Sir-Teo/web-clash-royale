import { CARD_MAP } from "./cards";
import { COMBAT_STEP, HEAL_PER_TICK, combatTraits } from "./combat";
import type { Entity, Projectile } from "./engine";
import {
  damagePacketOrder,
  projectileDamagePackets,
} from "./projectile-impacts";
import type { WindupHealthEvaluator, WindupHealthFrame } from "./tornado-pull";
import heal from "./heal-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import tornado from "./tornado-data.json" with { type: "json" };

/** Known health/control changes until this current attack releases. Positions
 * follow only the projected pulls; no future attacks, deaths or summons run. */
export function createWindupHealth(
  projectiles: readonly Projectile[],
  entities: readonly Entity[],
): WindupHealthEvaluator {
  return (attacker, frames, originalAreas) => {
    const path = frames.map((f) => f.position);
    const packets = projectileDamagePackets(
      attacker,
      projectiles,
      entities,
      path,
    ).sort(damagePacketOrder);
    const areas = originalAreas.map((a) => ({ ...a }));
    let hp = attacker.hp,
      shield = attacker.shield ?? 0;
    let healing = attacker.heal ? { ...attacker.heal } : undefined;
    let poisoned = attacker.poison ? { ...attacker.poison } : undefined;
    let cursor = 0;
    const hurt = (damage: number, bypass = false) => {
      if (hp <= 0) return;
      if (shield > 0 && !bypass) shield = Math.max(0, shield - damage);
      else hp = Math.max(0, hp - damage);
    };
    const result: WindupHealthFrame[] = [];
    for (const [index, frame] of frames.entries()) {
      const step = index + 1;
      areas.forEach((area, areaIndex) => {
        if (area.remaining <= 0) return;
        const position = frame.areaPositions[areaIndex];
        const inside =
          hp > 0 &&
          Math.hypot(position.x - area.x, position.y - area.y) <
            area.radius + attacker.radius;
        const age = area.duration - area.remaining;
        if (
          (area.card === "poison" || area.card === "heal") &&
          age + 1e-8 >= (area.hitAt ?? 0)
        ) {
          area.hitAt =
            (area.hitAt ?? 0) +
            (area.card === "poison"
              ? poison.areaHitInterval
              : heal.areaHitInterval);
          if (
            inside &&
            area.card === "heal" &&
            area.team === attacker.team &&
            attacker.kind === "troop"
          ) {
            healing ??= { remaining: 0, elapsed: 0 };
            healing.remaining = heal.buffDuration;
          }
          if (inside && area.card === "poison" && area.team !== attacker.team) {
            poisoned ??= { remaining: 0, elapsed: 0 };
            poisoned.remaining = poison.buffDuration;
          }
        }
        if (
          area.card === "tornado" &&
          age + 1e-8 >= (area.damageAt ?? tornado.damageInterval)
        ) {
          area.damageAt =
            (area.damageAt ?? tornado.damageInterval) + tornado.damageInterval;
          if (
            inside &&
            area.team !== attacker.team &&
            attacker.kind === "troop"
          )
            hurt(CARD_MAP.tornado.damage);
        }
        area.remaining = Math.max(0, area.remaining - COMBAT_STEP);
        if (area.card !== "ice-golem" && area.remaining < 1e-8)
          area.remaining = 0;
      });
      if (healing) {
        healing.remaining = Math.max(0, healing.remaining - COMBAT_STEP);
        healing.elapsed += COMBAT_STEP;
        if (hp > 0 && healing.elapsed + 1e-8 >= heal.healInterval) {
          healing.elapsed -= heal.healInterval;
          hp = Math.min(attacker.maxHp, hp + HEAL_PER_TICK);
        }
        if (healing.remaining < 1e-8 || hp <= 0) healing = undefined;
      }
      if (poisoned && hp > 0) {
        poisoned.remaining = Math.max(0, poisoned.remaining - COMBAT_STEP);
        poisoned.elapsed += COMBAT_STEP;
        if (poisoned.elapsed + 1e-8 >= poison.damageInterval) {
          poisoned.elapsed -= poison.damageInterval;
          hurt(
            CARD_MAP.poison.damage *
              (attacker.kind === "tower" ? poison.crownTowerDamageFraction : 1),
          );
        }
        if (poisoned.remaining < 1e-8) poisoned = undefined;
      }
      if (attacker.lifetime)
        hurt((attacker.maxHp / attacker.lifetime) * COMBAT_STEP, true);
      const beforeAlive = hp > 0;
      let interrupt = false,
        slow = 0;
      while (cursor < packets.length && packets[cursor].step === step) {
        const packet = packets[cursor++];
        if (hp <= 0) continue;
        hurt(packet.damage);
        if (hp <= 0) continue;
        const shot = projectiles[packet.order];
        const push =
          shot.style === "log" ||
          shot.style === "log-launch" ||
          shot.style === "bowler" ||
          (shot.splash > 0 && !!shot.knockback);
        if (
          (shot.splash > 0 && !!shot.stun) ||
          (push &&
            attacker.kind === "troop" &&
            !combatTraits(attacker).ignoresKnockback)
        )
          interrupt = true;
        if (shot.splash > 0 && shot.slow) slow = Math.max(slow, shot.slow);
      }
      result.push({ beforeAlive, afterAlive: hp > 0, interrupt, slow });
    }
    return result;
  };
}
