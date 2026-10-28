import { projectileCrownDamage } from "./crown-damage";
import { aiBodyValue } from "./ai-body-value";
import { CARD_MAP } from "./cards";
import type { AreaEffect, Entity, Projectile, Team } from "./engine";
import { createKingSpellRace, kingRacePriority } from "./king-damage";
import { logCandidatePoints, logSpellContains } from "./log-flight";
import type { MatchFinisher } from "./match-finisher";
import { createSpellDamageReservation } from "./spell-reservations";
import { hiddenSpellTarget, type SpellTarget } from "./spell-targeting";
import log from "./log-data.json" with { type: "json" };

/** Value actual ground contacts along the stationary rolling corridor. */
export function logSpellTarget(
  team: Team,
  entities: readonly Entity[],
  projectiles: readonly Projectile[],
  areas: readonly AreaEffect[],
  cost = CARD_MAP.log.cost,
  kingDeadline = Infinity,
  finisher?: MatchFinisher,
): SpellTarget | undefined {
  const enemies = entities.filter(
    (e) =>
      e.team !== team && e.hp > 0 && !e.air && !e.dash && !hiddenSpellTarget(e),
  );
  const king = enemies.find((e) => e.king);
  const race =
    king && !finisher
      ? createKingSpellRace("log", team, king, projectiles, areas, entities)
      : undefined;
  const reserve = createSpellDamageReservation(
    team,
    entities,
    projectiles,
    areas,
  );
  const targets = enemies
    .map((entity) => {
      const reserved = reserve(entity);
      const hp = Math.max(0, entity.hp + (entity.shield ?? 0) - reserved);
      const shield = Math.max(0, (entity.shield ?? 0) - reserved);
      const packet = projectileCrownDamage(
        "log",
        entity,
        CARD_MAP.log.damage,
        log.crownTowerDamageFraction,
      );
      const damage = shield > 0 ? Math.min(shield, packet) : packet;
      const lethal = hp > 1e-6 && hp <= damage + 1e-6;
      const value =
        entity.kind === "tower"
          ? lethal
            ? 0
            : (Math.min(damage, hp) / entity.maxHp) * 2
          : aiBodyValue(entity) *
            Math.min(
              1,
              Math.min(damage, hp) / (entity.maxHp + (entity.maxShield ?? 0)) +
                (lethal ? 0.35 : 0),
            ) *
            ((team === "red" ? entity.y < 15 : entity.y > 17) ? 1.2 : 1);
      return {
        entity,
        hp,
        value,
        lethal,
        penalty: hp > damage && entity.king && !entity.active ? cost + 8 : 0,
      };
    })
    .filter(
      (t) =>
        t.hp > 1e-6 ||
        finisher?.reordersLightning ||
        (finisher && t.entity.kind === "tower") ||
        (t.entity.king &&
          race &&
          Number.isFinite(kingDeadline) &&
          race.baseline >= kingDeadline),
    );
  let best: SpellTarget | undefined;
  for (const point of logCandidatePoints(
    team,
    targets.map((t) => t.entity),
  )) {
    let value = 0,
      penalty = 0,
      kingStep = Infinity;
    let lethalTower: Entity | undefined;
    for (const target of targets) {
      if (!logSpellContains(team, point, target.entity)) continue;
      value += target.value;
      penalty += target.penalty;
      if (target.entity.king && race) {
        const step = race.stepAt(point);
        if (step < race.baseline) {
          lethalTower = target.entity;
          kingStep = step;
        }
      } else if (
        target.entity.kind === "tower" &&
        target.lethal &&
        (!finisher || (!finisher.tracksCrowns && !target.entity.king)) &&
        !lethalTower?.king
      )
        lethalTower = target.entity;
    }
    const match = finisher?.evaluate("log", point, cost, value);
    const score =
      match?.score ??
      (lethalTower
        ? (lethalTower.king
            ? kingRacePriority(kingStep, kingDeadline) -
              Math.min(1, kingStep * 0.001)
            : 40) -
          cost +
          Math.min(lethalTower.king ? 0.1 : 100, value) -
          penalty
        : 3 + 2 * (value - cost * 0.8) - penalty);
    if (!match && !lethalTower && (value < cost * 0.8 || score <= 0)) continue;
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
