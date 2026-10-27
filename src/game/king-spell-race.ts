import { attackReach, minimumAttackDistance } from "./attack-range";
import type { CardId } from "./cards";
import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import iceGolem from "./ice-golem-data.json" with { type: "json" };
import miner from "./miner-data.json" with { type: "json" };
import { attackHitSteps } from "./attack-flight";
import { createKingSpellRace } from "./king-damage";
import { electroExtraTarget } from "./electro-bolts";

const contains = (area: Point & { radius: number }, body: Entity) =>
  Math.hypot(area.x - body.x, area.y - body.y) < area.radius + body.radius;

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
    const nativeElectro = attacker.card === "electro-wizard" && attacker.nativeExtraTargets;
    const primary = nativeElectro && pending
      ? entities.find((entity) => entity.id === pending.target && entity.hp > 0)
      : king;
    const kingDamage = !pending || !primary ? 0 : nativeElectro
      ? pending.damage * (Number(primary.id === king.id) +
        Number(electroExtraTarget(attacker, primary, entities)?.id === king.id))
      : attacker.card === "miner"
        ? Math.round(pending.damage * miner.crownTowerDamageFraction)
        : pending.damage;
    if (
      attacker.team === team ||
      attacker.hp <= 0 ||
      !attacker.active ||
      attacker.deploy > 0 ||
      attacker.stun > 0 ||
      attacker.dash ||
      !pending ||
      !primary ||
      (!nativeElectro && pending.target !== king.id) ||
      kingDamage < king.hp ||
      pending.remaining > 1 ||
      Math.hypot(attacker.x - primary.x, attacker.y - primary.y) >
        attackReach(attacker, primary) ||
      (attacker.minimumRange !== undefined &&
        Math.hypot(attacker.x - primary.x, attacker.y - primary.y) < minimumAttackDistance(attacker, primary)) ||
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
        const flight = attackHitSteps(attacker, primary);
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
