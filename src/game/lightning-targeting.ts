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
import lightning from "./lightning-data.json" with { type: "json" };
import { createMovingLightningPlan } from "./windup-health";
import { createSpellDamageReservation } from "./spell-reservations";
import {
  hiddenSpellTarget,
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
  const strikesAt = createMovingLightningPlan(
    team,
    entities,
    undefined,
    projectiles,
    areas,
  );
  const reservedDamage = createSpellDamageReservation(
    team,
    entities,
    projectiles,
    areas,
  );
  let best: SpellTarget | undefined;
  for (const point of spellCandidatePoints(enemies, lightning.radius)) {
    let value = 0,
      penalty = 0,
      kingStep = Infinity;
    let lethalTower: Entity | undefined;
    const projection = strikesAt.project(point);
    const packets = projection.packets;
    const deaths = new Map<number, { baseline: number; proposed: number }>();
    for (const e of enemies) {
      if (e.kind !== "tower") continue;
      const forecast = towers.get(e.id)!;
      const baseline = kingDeathStep(e, forecast.baseline);
      const proposed = kingDeathStep(e, [
        ...forecast.withoutLightning,
        ...(packets.get(e.id) ?? []),
      ]);
      deaths.set(e.id, { baseline, proposed });
      if (proposed < baseline && (!lethalTower || e.king)) {
        lethalTower = e;
        kingStep = proposed;
      }
    }
    for (const { entity: e } of projection.strikes) {
      // A live friendly cloud already covers this body. Keep it in the
      // selection order, but do not count its damage as new value again.
      if (
        e.dash ||
        (e.kind !== "tower" &&
          areas.some(
            (a) =>
              a.card === "lightning" &&
              a.team === team &&
              a.remaining > 0 &&
              spellContains(a, e, a.radius + e.radius),
          ))
      )
        continue;
      const packet =
        CARD_MAP.lightning.damage *
        (e.kind === "tower" ? lightning.crownTowerDamageFraction : 1);
      const shield = e.shield ?? 0;
      if (e.kind === "tower") {
        const { baseline, proposed } = deaths.get(e.id)!;
        if (proposed >= baseline && !Number.isFinite(baseline)) {
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
        const reserved = reservedDamage(e);
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
    const match = finisher?.evaluateDamage(packets, cost, value, true);
    // Once the King falls, later troop strikes add no winning value. Prefer
    // an earlier King pulse over incidental damage elsewhere in the circle.
    const kingBonus = lethalTower?.king
      ? (lightning.duration / COMBAT_STEP - kingStep) * 0.01 +
        Math.min(value, 0.1)
      : Math.min(value, 100);
    const ordinaryFinisher =
      lethalTower &&
      (!finisher || (!finisher.tracksCrowns && !lethalTower.king));
    const score =
      match?.score ??
      (ordinaryFinisher
        ? (lethalTower?.king ? kingRacePriority(kingStep, kingDeadline) : 40) -
          cost +
          kingBonus -
          penalty
        : 3 + 2 * (value - cost * 0.8) - penalty);
    if (!match && !ordinaryFinisher && (value < cost * 0.8 || score <= 0))
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
