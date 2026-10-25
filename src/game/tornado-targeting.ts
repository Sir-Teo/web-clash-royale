import { CARD_MAP } from "./cards";
import { aiBodyValue } from "./ai-body-value";
import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { fatalKingWindups } from "./king-spell-race";
import { launchedKingDeadline } from "./king-damage";
import { createSpellDamageReservation } from "./spell-reservations";
import {
  hiddenSpellTarget,
  spellCandidatePoints,
  spellContains,
  type SpellTarget,
} from "./spell-targeting";
import { tornadoEscapeStep, tornadoPull } from "./tornado-pull";
import tornado from "./tornado-data.json" with { type: "json" };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Damage groups and pull deployed pressure away from friendly towers. */
export function tornadoSpellTarget(
  team: Team,
  entities: readonly Entity[],
  areas: readonly AreaEffect[],
  projectiles: readonly Projectile[],
  cost = CARD_MAP.tornado.cost,
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
  const king = towers.find((e) => e.king);
  const windups = king
    ? fatalKingWindups(team, entities, areas).map((windup) => ({
        ...windup,
        controlled:
          tornadoEscapeStep(windup.attacker, king, areas) !== undefined,
      }))
    : [];
  const fatal = windups.filter((windup) => !windup.controlled);
  const canProtect =
    fatal.length > 0 &&
    !Number.isFinite(launchedKingDeadline(team, entities, projectiles, areas));
  const reserve = createSpellDamageReservation(
    team,
    entities,
    projectiles,
    areas,
  );
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
      (!t.pressure && !fatal.some((f) => f.attacker.id === t.entity.id))
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
  let best: SpellTarget | undefined;
  for (const point of points.values()) {
    const escapes = windups.map(({ attacker }) =>
      tornadoEscapeStep(attacker, king!, areas, point),
    );
    // A second pull must preserve a rescue the current areas already provide.
    if (windups.some((w, i) => w.controlled && escapes[i] === undefined))
      continue;
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
    const protectsKing =
      canProtect && escapes.every((step) => step !== undefined);
    const score = protectsKing
      ? 9_000 - cost + Math.min(100, value)
      : 3 + 2 * (value - cost * 0.9) - penalty;
    if (!protectsKing && (value < cost * 0.9 || score <= 0)) continue;
    if (!best || score > best.score + 1e-8)
      best = {
        ...point,
        score,
        value,
        ...(protectsKing ? { protectsKing: true } : {}),
      };
  }
  return best;
}
