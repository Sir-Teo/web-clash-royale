import { aiBodyValue } from "./ai-body-value";
import { CARD_MAP } from "./cards";
import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Projectile, Team } from "./engine";
import {
  kingDeathStep,
  kingRacePriority,
  towerDamageForecast,
} from "./king-damage";
import type { MatchFinisher } from "./match-finisher";
import type { DamagePacket } from "./projectile-impacts";
import lightning from "./lightning-data.json" with { type: "json" };
import { createLightningPlan } from "./lightning-strikes";
import {
  hiddenSpellTarget,
  pendingSpellDamage,
  spellCandidatePoints,
  spellContains,
  type SpellTarget,
} from "./spell-targeting";

export function lightningSpellTarget(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  cost = CARD_MAP.lightning.cost,
  kingDeadline = Infinity,
  finisher?: MatchFinisher,
): SpellTarget | undefined {
  const enemies = entities.filter(
    (e) => e.hp > 0 && e.team !== team && !hiddenSpellTarget(e),
  );
  const towers = new Map(
    enemies
      .filter((e) => e.kind === "tower")
      .map((e) => [e.id, towerDamageForecast(e, projectiles, areas, entities)]),
  );
  const strikesAt = createLightningPlan(team, enemies);
  let best: SpellTarget | undefined;
  for (const point of spellCandidatePoints(enemies, lightning.radius)) {
    let value = 0,
      penalty = 0,
      kingStep = Infinity;
    let lethalTower: Entity | undefined;
    const packets = new Map<number, DamagePacket[]>();
    for (const { entity: e, step } of strikesAt(point)) {
      // A live friendly cloud already covers this body. Keep it in the
      // selection order, but do not count its damage as new value again.
      if (
        e.dash ||
        areas.some(
          (a) =>
            a.card === "lightning" &&
            a.team === team &&
            a.remaining > 0 &&
            spellContains(a, e, a.radius + e.radius),
        )
      )
        continue;
      const packet =
        CARD_MAP.lightning.damage *
        (e.kind === "tower" ? lightning.crownTowerDamageFraction : 1);
      const shield = e.shield ?? 0;
      if (e.kind === "tower") {
        const forecast = towers.get(e.id)!;
        const hit: DamagePacket = {
          step,
          damage: packet,
          phase: -1,
          born: 0,
          order: areas.length,
        };
        packets.set(e.id, [hit]);
        const baseline = kingDeathStep(e, forecast.baseline);
        const death = kingDeathStep(e, [...forecast.baseline, hit]);
        if (death < baseline) {
          if (!lethalTower || e.king) {
            lethalTower = e;
            kingStep = death;
          }
        } else if (!Number.isFinite(baseline)) {
          value +=
            (Math.min(
              shield > 0 ? Math.min(shield, packet) : packet,
              e.hp + shield,
            ) /
              e.maxHp) *
            2;
          if (e.king && !e.active) penalty += cost + 8;
        }
      } else {
        const reserved = pendingSpellDamage(e, team, projectiles, areas);
        const hp = Math.max(0, e.hp + shield - reserved);
        const remainingShield = Math.max(0, shield - reserved);
        const damage =
          remainingShield > 0 ? Math.min(remainingShield, packet) : packet;
        const removal = hp > 0 && hp <= damage ? 0.35 : 0;
        const defense = (team === "red" ? e.y < 15 : e.y > 17) ? 1.2 : 1;
        value +=
          aiBodyValue(e) *
          Math.min(
            1,
            Math.min(damage, hp) / (e.maxHp + (e.maxShield ?? 0)) + removal,
          ) *
          defense;
      }
    }
    const match = finisher?.evaluateDamage(packets, cost, value);
    // Once the King falls, later troop strikes add no winning value. Prefer
    // an earlier King pulse over incidental damage elsewhere in the circle.
    const kingBonus = lethalTower?.king
      ? (lightning.duration / COMBAT_STEP - kingStep) * 0.01 +
        Math.min(value, 0.1)
      : Math.min(value, 100);
    const score =
      match?.score ??
      (lethalTower && !finisher
        ? (lethalTower.king ? kingRacePriority(kingStep, kingDeadline) : 40) -
          cost +
          kingBonus -
          penalty
        : 3 + 2 * (value - cost * 0.8) - penalty);
    if (
      !match &&
      (!lethalTower || finisher) &&
      (value < cost * 0.8 || score <= 0)
    )
      continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(lethalTower ? { lethalTower: lethalTower.id } : {}),
        ...(match
          ? { matchDecisionStep: match.matchDecisionStep }
          : lethalTower?.king
            ? { matchDecisionStep: kingStep }
            : {}),
      };
  }
  return best;
}
