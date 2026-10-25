import { aiBodyValue as bodyValue } from "./ai-body-value";
import { CARD_MAP, type CardId } from "./cards";
import type { AreaEffect, Entity, Projectile, Team } from "./engine";
import poison from "./poison-data.json" with { type: "json" };
import { supportSpellTarget } from "./support-spell-targeting";
import { fatalKingWindups } from "./king-spell-race";
import { createKingSpellRace, kingRacePriority } from "./king-damage";
import type { MatchFinisher } from "./match-finisher";
import {
  hiddenSpellTarget,
  pendingSpellDamage,
  spellCandidatePoints,
  spellContains,
  type SpellTarget,
} from "./spell-targeting";

const health = (e: Entity) => Math.max(0, Math.min(1, e.hp / e.maxHp));
const AREA_SPELLS = new Set<CardId>([
  "rage",
  "freeze",
  "poison",
  "heal",
  "clone",
]);
export const isAreaSpell = (card: CardId) => AREA_SPELLS.has(card);
const covered = (
  e: Entity,
  card: AreaEffect["card"],
  team: Team,
  areas: readonly AreaEffect[],
  remaining = 0.5,
) =>
  areas.some(
    (a) =>
      a.card === card &&
      a.team === team &&
      a.remaining > remaining &&
      spellContains(a, e, a.radius + e.radius),
  );
const near = (a: Entity, b: Entity, extra = 0) =>
  spellContains(a, b, a.range + a.radius + b.radius + extra);
const canHit = (a: Entity, b: Entity) => {
  if (a.kind === "tower") return true;
  const card = CARD_MAP[a.card as CardId];
  return (
    (!card.buildingsOnly || b.kind !== "troop") && (!b.air || !!card.hitsAir)
  );
};

/** Current-position support heuristics; no simulation or random draws. */
export function areaSpellTarget(
  card: CardId,
  team: Team,
  entities: readonly Entity[],
  areas: readonly AreaEffect[] = [],
  projectiles: readonly Projectile[] = [],
  cost = CARD_MAP[card].cost,
  kingDeadline = Infinity,
  finisher?: MatchFinisher,
): SpellTarget | undefined {
  if (card === "heal" || card === "clone")
    return supportSpellTarget(card, team, entities, areas, projectiles, cost);
  if (card !== "rage" && card !== "freeze" && card !== "poison") return;
  const living = entities.filter((e) => e.hp > 0);
  const friends = living.filter(
    (e) => e.team === team && e.deploy <= 0 && !hiddenSpellTarget(e),
  );
  const enemies = living.filter((e) => e.team !== team);
  const enemyKing = enemies.find((e) => e.king);
  const race =
    !finisher && card === "poison" && Number.isFinite(kingDeadline) && enemyKing
      ? createKingSpellRace(card, team, enemyKing, projectiles, areas, entities)
      : undefined;
  const radius = CARD_MAP[card].radius!;
  const kingThreats = new Set(
    card === "freeze"
      ? fatalKingWindups(team, entities, areas).map(
          (windup) => windup.attacker.id,
        )
      : [],
  );
  const targets: {
    entity: Entity;
    value: number;
    penalty: number;
    lethal: boolean;
    protectsKing?: boolean;
  }[] = [];
  if (card === "rage") {
    for (const e of friends) {
      if (
        e.kind !== "troop" ||
        e.stun > 1 ||
        (e.rage?.remaining ?? 0) > 0.5 ||
        covered(e, "rage", team, areas) ||
        areas.some(
          (a) =>
            a.team !== team &&
            a.card === "freeze" &&
            a.remaining > 0.5 &&
            spellContains(a, e, a.radius + e.radius),
        )
      )
        continue;
      const engaged = enemies.some(
        (foe) => !hiddenSpellTarget(foe) && canHit(e, foe) && near(e, foe, 1),
      );
      const advancing =
        e.kind === "troop" && (team === "red" ? e.y >= 10 : e.y <= 22);
      if (!engaged && !advancing) continue;
      targets.push({
        entity: e,
        value: bodyValue(e) * (0.25 + 0.75 * health(e)),
        penalty: 0,
        lethal: false,
      });
    }
  } else if (card === "freeze") {
    for (const e of enemies) {
      if (
        e.deploy > 0 ||
        !!e.dash ||
        e.stun > 0.3 ||
        covered(e, "freeze", team, areas, 0.3) ||
        (e.kind === "tower" && !e.active)
      )
        continue;
      // Freeze cancels a windup before combat resolves. Released projectiles
      // and attacks already cancelled by stun cannot justify this override.
      const protectsKing = kingThreats.has(e.id);
      const support = friends
        .filter(
          (friend) =>
            canHit(e, friend) && near(friend, e, 1) && near(e, friend, 1),
        )
        .reduce(
          (sum, friend) =>
            sum + bodyValue(friend) * (0.25 + 0.75 * health(friend)),
          0,
        );
      if (support < 2 && !protectsKing) continue;
      targets.push({
        entity: e,
        value: bodyValue(e) * (0.5 + 0.5 * health(e)),
        penalty: 0,
        lethal: false,
        protectsKing,
      });
    }
  } else {
    for (const e of enemies) {
      const alreadyCovered = covered(e, "poison", team, areas);
      if (
        hiddenSpellTarget(e) ||
        (alreadyCovered &&
          !(e.king && race) &&
          !(finisher && e.kind === "tower")) ||
        (!finisher && e.king && race && race.baseline < kingDeadline)
      )
        continue;
      if (finisher && alreadyCovered && e.kind === "tower") {
        // Keep the center for a possible useful refresh, without counting
        // an existing cloud's tower damage again as ordinary spell value.
        targets.push({ entity: e, value: 0, penalty: 0, lethal: false });
        continue;
      }
      const reserved = pendingSpellDamage(e, team, projectiles);
      const hp = Math.max(0, e.hp + (e.shield ?? 0) - reserved);
      let shield = Math.max(0, (e.shield ?? 0) - reserved);
      if (hp <= 1e-6 && !(e.king && race) && !(finisher && e.kind === "tower"))
        continue;
      const fighting = friends.some((friend) => near(e, friend));
      const dwell =
        e.kind !== "troop"
          ? poison.duration
          : fighting
            ? 4
            : Math.min(3, (2 * radius) / Math.max(0.1, e.speed));
      const ticks = Math.floor(dwell / poison.damageInterval);
      const packet =
        CARD_MAP.poison.damage *
        (e.kind === "tower" ? poison.crownTowerDamageFraction : 1);
      let damage = 0;
      for (let i = 0; i < ticks; i++) {
        const hit = shield > 0 ? Math.min(shield, packet) : packet;
        damage += hit;
        shield = Math.max(0, shield - hit);
      }
      const lethal = e.kind === "tower" && hp > 1e-6 && hp <= damage + 1e-6;
      const defense = (team === "red" ? e.y < 15 : e.y > 17) ? 1.2 : 1;
      const value =
        e.kind === "tower"
          ? lethal
            ? 0
            : (Math.min(damage, hp) / e.maxHp) * 2
          : bodyValue(e) *
            Math.min(
              1,
              Math.min(damage, hp) / (e.maxHp + (e.maxShield ?? 0)) +
                (hp <= damage ? 0.35 : 0),
            ) *
            defense;
      targets.push({
        entity: e,
        value,
        lethal,
        penalty:
          e.kind === "tower" && e.king && !e.active && !lethal
            ? CARD_MAP.poison.cost + 8
            : 0,
      });
    }
  }
  let best: SpellTarget | undefined;
  for (const point of spellCandidatePoints(
    targets.map((t) => t.entity),
    radius,
  )) {
    let value = 0,
      penalty = 0,
      king = false,
      protectsKing = false,
      kingStep = Infinity,
      lethalTower: number | undefined;
    for (const t of targets) {
      if (!spellContains(point, t.entity, radius + t.entity.radius)) continue;
      if (t.entity.king && race) {
        const step = race.stepAt(point);
        if (step < race.baseline) {
          lethalTower = t.entity.id;
          king = true;
          kingStep = step;
          continue;
        }
        value += t.value;
        penalty += t.penalty;
        continue;
      }
      value += t.value;
      penalty += t.penalty;
      protectsKing ||= !!t.protectsKing;
      if (
        !finisher &&
        t.lethal &&
        (lethalTower === undefined || t.entity.king)
      ) {
        lethalTower = t.entity.id;
        king = !!t.entity.king;
      }
    }
    const threshold =
      card === "rage"
        ? (5 * cost) / CARD_MAP.rage.cost
        : cost * (card === "poison" ? 0.8 : 1);
    // Keep emergency protection below a winning King hit, above ordinary
    // support value. Bound the crowd bonus so that priority cannot invert.
    const match =
      card === "poison"
        ? finisher?.evaluate(card, point, cost, value)
        : undefined;
    const score =
      match?.score ??
      (lethalTower !== undefined
        ? (king && race
            ? kingRacePriority(kingStep, kingDeadline)
            : king
              ? 10_000
              : 40) -
          cost -
          poison.duration * 0.1 +
          (king && race ? Math.min(100, value) : value) -
          penalty
        : protectsKing
          ? 9_000 - cost + Math.min(100, value)
          : 3 + 2 * (value - threshold) - penalty);
    if (
      lethalTower === undefined &&
      !protectsKing &&
      !match &&
      (value < threshold || score <= 0)
    )
      continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(match ? { matchDecisionStep: match.matchDecisionStep } : {}),
        ...(lethalTower !== undefined ? { lethalTower } : {}),
        ...(protectsKing ? { protectsKing: true } : {}),
      };
  }
  return best;
}
