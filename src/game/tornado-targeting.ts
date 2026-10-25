import { CARD_MAP } from "./cards";
import { aiBodyValue } from "./ai-body-value";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import {
  createKingDefense,
  kingDefenseScore,
  type KingDefense,
} from "./king-defense";
import type { MatchFinisher } from "./match-finisher";
import { createSpellDamageReservation } from "./spell-reservations";
import {
  hiddenSpellTarget,
  spellCandidatePoints,
  spellContains,
  type SpellTarget,
} from "./spell-targeting";
import { tornadoPull } from "./tornado-pull";
import tornado from "./tornado-data.json" with { type: "json" };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Damage groups and pull deployed pressure away from friendly towers. */
export function tornadoSpellTarget(
  team: Team,
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
  cost = CARD_MAP.tornado.cost,
  kingDefense?: KingDefense,
  finisher?: MatchFinisher,
): SpellTarget | undefined {
  const enemies = entities.filter(
    (e) =>
      e.hp > 0 &&
      e.team !== team &&
      e.kind === "troop" &&
      !e.dash &&
      !hiddenSpellTarget(e),
  );
  const towers = entities.filter(
    (e) => e.hp > 0 && e.team === team && e.kind === "tower",
  );
  const defense =
    kingDefense ?? createKingDefense(team, entities, projectiles, areas);
  const reserve = createSpellDamageReservation(
    team,
    entities,
    projectiles,
    areas,
  );
  const lightning = finisher
    ? areas.filter(
        (a) =>
          a.card === "lightning" &&
          a.team === team &&
          a.remaining > 0 &&
          entities.some(
            (e) =>
              e.kind === "tower" &&
              e.team !== team &&
              e.hp > 0 &&
              !(a.struck ?? []).includes(e.id) &&
              spellContains(a, e, a.radius + e.radius),
          ),
      )
    : [];
  const evaluated = enemies.map((e) => {
    const reserved = reserve(e);
    const hp = Math.max(0, e.hp + (e.shield ?? 0) - reserved);
    let shield = Math.max(0, (e.shield ?? 0) - reserved),
      damage = 0;
    for (
      let i = 0;
      i < Math.floor(tornado.duration / tornado.damageInterval);
      i++
    ) {
      const hit =
        shield > 0
          ? Math.min(shield, CARD_MAP.tornado.damage)
          : CARD_MAP.tornado.damage;
      damage += hit;
      shield = Math.max(0, shield - hit);
    }
    const covered = areas.some(
      (a) =>
        a.card === "tornado" &&
        a.team === team &&
        a.remaining > 0.5 &&
        spellContains(a, e, a.radius + e.radius),
    );
    const bodyValue = aiBodyValue(e);
    const nearTower = [...towers].sort(
      (a, b) => distance(e, a) - distance(e, b),
    )[0];
    const pressure =
      nearTower &&
      e.deploy <= 0 &&
      e.active &&
      distance(e, nearTower) <= e.range + nearTower.radius + e.radius + 4;
    const health = Math.max(0, Math.min(1, e.hp / e.maxHp));
    return {
      entity: e,
      hp,
      covered,
      bodyValue,
      nearTower,
      pressure,
      control: bodyValue * (0.25 + 0.75 * health),
      damageValue:
        bodyValue *
        Math.min(
          1,
          Math.min(damage, hp) / (e.maxHp + (e.maxShield ?? 0)) +
            (hp > 1e-6 && hp <= damage ? 0.35 : 0),
        ) *
        ((team === "red" ? e.y < 15 : e.y > 17) ? 1.2 : 1),
    };
  });
  const points = new Map<string, Point>();
  const add = (point: Point) => {
    const legal = {
      x: Math.max(0.5, Math.min(17.5, point.x)),
      y: Math.max(0.7, Math.min(31.3, point.y)),
    };
    points.set(`${legal.x.toFixed(3)},${legal.y.toFixed(3)}`, legal);
  };
  for (const point of spellCandidatePoints(enemies, tornado.radius)) add(point);
  for (const t of evaluated) {
    if (
      !t.nearTower ||
      (!t.pressure &&
        !defense.threats.some((f) => f.attacker.id === t.entity.id))
    )
      continue;
    const gap = distance(t.entity, t.nearTower);
    if (gap <= 1e-8) continue;
    for (const reach of [3, 5])
      add({
        x: t.entity.x + ((t.entity.x - t.nearTower.x) / gap) * reach,
        y: t.entity.y + ((t.entity.y - t.nearTower.y) / gap) * reach,
      });
  }
  // Pull blockers away from a pending circle even when their reserved damage
  // leaves no ordinary removal value. Their movement can expose a tower.
  for (const cloud of lightning) {
    add(cloud);
    for (const e of enemies) {
      const gap = distance(e, cloud);
      if (gap <= 1e-8) continue;
      for (const reach of [3, 5])
        add({
          x: e.x + ((e.x - cloud.x) / gap) * reach,
          y: e.y + ((e.y - cloud.y) / gap) * reach,
        });
    }
  }
  let best: SpellTarget | undefined;
  for (const point of points.values()) {
    const rescue = defense.evaluate("tornado", point);
    // A second pull must preserve a rescue the current areas already provide.
    if (rescue.worsens) continue;
    if (
      lightning.length &&
      !rescue.improves &&
      finisher!.baseline?.winner === team
    ) {
      const ending = finisher!.outcomeAt("tornado", point);
      if (ending?.winner !== team || ending.step > finisher!.baseline.step)
        continue;
    }
    let value = 0,
      penalty = 0;
    for (const t of evaluated) {
      if (
        t.hp <= 1e-6 ||
        t.covered ||
        !spellContains(point, t.entity, tornado.radius + t.entity.radius)
      )
        continue;
      value += t.damageValue;
      if (!t.pressure || !t.nearTower || t.entity.speed <= 0) continue;
      const moved = tornadoPull(t.entity, point);
      if (!moved) continue;
      const gain =
        distance(moved, t.nearTower) - distance(t.entity, t.nearTower);
      // Direction, rather than an assumed three-second residence, values
      // control. Do not reward pulling an attacker closer to another tower.
      const towardTower = towers.some(
        (tower) => distance(moved, tower) < distance(t.entity, tower) - 1e-6,
      );
      if (gain > 0 && !towardTower)
        value +=
          t.control *
          0.75 *
          Math.min(
            1,
            gain /
              (t.entity.speed *
                tornado.attractPercentage *
                tornado.areaHitInterval),
          );
      else if (gain < 0 || towardTower) penalty += t.control;
    }
    const protectsKing = rescue.improves;
    const match = lightning.length
      ? finisher!.evaluate("tornado", point, cost, value)
      : undefined;
    const score =
      match?.score ??
      (protectsKing
        ? kingDefenseScore(rescue, cost, value)
        : 3 + 2 * (value - cost * 0.9) - penalty);
    if (!match && !protectsKing && (value < cost * 0.9 || score <= 0)) continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(match ? { matchDecisionStep: match.matchDecisionStep } : {}),
        ...(protectsKing
          ? { protectsKing: true, kingThreatStep: defense.baseline }
          : {}),
      };
  }
  return best;
}
