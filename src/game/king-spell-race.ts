import { CARD_MAP, type CardId } from "./cards";
import {
  COMBAT_STEP,
  directSpellFlight,
  SPELL_CROWN_TOWER_DAMAGE_FRACTION,
} from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import iceGolem from "./ice-golem-data.json" with { type: "json" };
import poison from "./poison-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import miner from "./miner-data.json" with { type: "json" };
import { attackHitSteps } from "./attack-flight";

const contains = (area: Point & { radius: number }, body: Entity) =>
  Math.hypot(area.x - body.x, area.y - body.y) < area.radius + body.radius;
const steps = (time: number) =>
  Math.max(1, Math.ceil((time - 1e-8) / COMBAT_STEP));

/** Only the current stationary windup and visible modifier clocks are read.
 * This does not predict new attacks, movement or future player commands. */
export function fatalKingWindups(
  team: Team,
  entities: readonly Entity[],
  areas: readonly AreaEffect[] = [],
) {
  const king = entities.find((e) => e.team === team && e.king && e.hp > 0);
  if (!king) return [];
  return entities.flatMap((attacker) => {
    const pending = attacker.pendingAttack;
    if (
      attacker.team === team ||
      attacker.hp <= 0 ||
      !attacker.active ||
      attacker.deploy > 0 ||
      attacker.stun > 0 ||
      attacker.dash ||
      !pending ||
      pending.target !== king.id ||
      (attacker.card === "miner"
        ? Math.round(pending.damage * miner.crownTowerDamageFraction)
        : pending.damage) < king.hp ||
      pending.remaining > 1 ||
      Math.hypot(attacker.x - king.x, attacker.y - king.y) >
        attacker.range + king.radius + attacker.radius * 0.35 ||
      areas.some(
        (a) =>
          a.card === "freeze" &&
          a.team === team &&
          a.remaining > 0 &&
          contains(a, attacker),
      )
    )
      return [];
    let boost = attacker.rage?.remaining ?? 0;
    let slow = attacker.slow?.remaining ?? 0;
    let remaining = pending.remaining;
    const clouds = areas
      .filter(
        (a) =>
          a.remaining > 0 &&
          contains(a, attacker) &&
          ((a.card === "rage" &&
            a.team === attacker.team &&
            attacker.kind === "troop") ||
            (a.card === "ice-golem" && a.team !== attacker.team)),
      )
      .map((a) => ({ ...a }));
    // At most one second of unmodified windup, or 47 steps under the current
    // 0.65 slow. Buffs expire before the combat clock advances each step.
    for (let step = 1; step <= 60; step++) {
      for (const cloud of clouds) {
        if (cloud.remaining <= 0) continue;
        if (cloud.card === "ice-golem")
          slow = Math.max(slow, iceGolem.slowDuration);
        else if (
          cloud.duration - cloud.remaining + 1e-8 >=
          (cloud.hitAt ?? 0)
        ) {
          cloud.hitAt = (cloud.hitAt ?? 0) + rage.areaHitInterval;
          boost = Math.max(boost, Math.min(rage.buffDuration, cloud.remaining));
        }
        cloud.remaining = Math.max(0, cloud.remaining - COMBAT_STEP);
        if (cloud.card !== "ice-golem" && cloud.remaining < 1e-8)
          cloud.remaining = 0;
      }
      boost = Math.max(0, boost - COMBAT_STEP);
      slow = Math.max(0, slow - COMBAT_STEP);
      remaining -=
        COMBAT_STEP *
        (boost >= 1e-8 ? rage.hitSpeedMultiplier : 1) *
        (slow >= 1e-8 ? iceWizard.hitSpeedMultiplier : 1);
      if (remaining <= 1e-8) {
        const flight = attackHitSteps(attacker, king);
        return Number.isFinite(flight)
          ? [{ attacker, step: step + flight - 1 }]
          : [];
      }
    }
    return [];
  });
}

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
): boolean {
  if (!Number.isFinite(deadline)) return true;
  let hp = target.hp,
    shield = target.shield ?? 0;
  const packets = projectiles
    .filter(
      (p) =>
        p.team === team &&
        p.source === 0 &&
        p.damage > 0 &&
        p.remaining > 0 &&
        ["fireball", "arrows", "zap", "rocket"].includes(p.style) &&
        Math.hypot(p.tx - target.x, p.ty - target.y) < p.splash + target.radius,
    )
    .map((p) => ({
      step:
        steps(p.remaining) + (p.delay && p.delay > 1e-8 ? steps(p.delay) : 0),
      damage:
        p.damage * (p.towerDamageFraction ?? SPELL_CROWN_TOWER_DAMAGE_FRACTION),
    }));
  if (card !== "poison")
    packets.push({
      step: steps(directSpellFlight(card, team, point).duration),
      damage:
        CARD_MAP[card].damage *
        (card === "rocket" ? rocket.crownTowerDamageFraction : 0.4),
    });
  const clouds = areas
    .filter(
      (a) =>
        a.card === "poison" &&
        a.team === team &&
        a.remaining > 0 &&
        contains(a, target),
    )
    .map((a) => ({ ...a }));
  if (card === "poison")
    clouds.push({
      id: -1,
      card: "poison",
      team,
      ...point,
      radius: poison.radius,
      remaining: poison.duration,
      duration: poison.duration,
    });
  let status = target.poison ? { ...target.poison } : undefined;
  const hurt = (amount: number) => {
    if (shield > 0) shield = Math.max(0, shield - amount);
    else hp -= amount;
  };
  for (let step = 1; step < deadline; step++) {
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
    if (status) {
      status.remaining = Math.max(0, status.remaining - COMBAT_STEP);
      status.elapsed += COMBAT_STEP;
      if (status.elapsed + 1e-8 >= poison.damageInterval) {
        status.elapsed -= poison.damageInterval;
        hurt(CARD_MAP.poison.damage * poison.crownTowerDamageFraction);
      }
      if (status.remaining < 1e-8) status = undefined;
    }
    for (const packet of packets) if (packet.step === step) hurt(packet.damage);
    if (hp <= 0) return true;
  }
  return false;
}
