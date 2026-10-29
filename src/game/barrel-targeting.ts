import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { CARD_MAP } from "./cards";
import { deploymentRadius } from "./deployment";
import { barrelFormation } from "./barrel-formation";
import { attackReach, NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import { nativeSightRange } from "./sight-range";
import { primaryCandidateVisible } from "./primary-geometry";
import { barrelTargetScoreBias, comparePrimaryTargets } from "./primary-score";
import { healthPackets } from "./status-health";
import { impactSteps } from "./projectile-impacts";
import { approachingBuildingThreat } from "./building-investment";
import barrel from "./goblin-barrel-data.json" with { type: "json" };

interface BarrelContext {
  team: Team;
  elixir: number;
  cost: number;
  remaining: number;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (point: Point) => boolean;
}
export interface BarrelTarget {
  point: Point;
  target: number;
  score: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Read-only quiet-field opportunities using the actual three-child factory. */
export function barrelTarget(context: BarrelContext): BarrelTarget | undefined {
  const { team, entities, projectiles, areas } = context;
  if (
    context.elixir + 1e-6 < context.cost + 2 ||
    approachingBuildingThreat(team, entities)
  )
    return;
  const enemies = entities.filter(
    (entity) => entity.team !== team && entity.hp > 0,
  );
  const visible = enemies.filter(
    (entity) =>
      !entity.air && !(entity.deploy <= 0 && entity.burrow?.phase === "hidden"),
  );
  const princesses = enemies.filter(
    (entity) => entity.kind === "tower" && !entity.king,
  );
  const goblin = CARD_MAP.goblins,
    radius = deploymentRadius("goblins");
  const origin = { x: 9, y: team === "red" ? 2 : 30 };
  const choices: (BarrelTarget & {
    health: number;
    exposure: number;
    travel: number;
  })[] = [];
  for (const target of visible.filter(
    (entity) => entity.kind === "tower" || entity.card === "elixir-collector",
  )) {
    const point = { x: target.x, y: target.y };
    if (
      !context.legal(point) ||
      projectiles.some(
        (p) =>
          p.team === team &&
          p.style === "goblin-barrel" &&
          p.remaining > 0 &&
          distance(point, { x: p.tx, y: p.ty }) <=
            target.radius + barrel.landingRadius,
      )
    )
      continue;
    const bodies = barrelFormation(point, team).map((position, index) => ({
      card: "goblins" as const,
      team,
      x: Math.max(0.6, Math.min(17.4, position.x)),
      y: Math.max(0.8, Math.min(31.2, position.y)),
      radius,
      range: goblin.range,
      rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
      sightRange: nativeSightRange({ card: "goblins", radius }),
      nativePrimaryScore: true as const,
      nativePrimaryGeometry: true as const,
      targetScoreBias: barrelTargetScoreBias(index),
    }));
    // Each child must immediately acquire this target, rather than a screen
    // or a dormant King. Use the same source bias and edge clamps as arrival.
    if (
      !bodies.every((body) => {
        let selected: Entity | undefined;
        for (const enemy of visible)
          if (
            primaryCandidateVisible(body, enemy) &&
            (!selected || comparePrimaryTargets(body, enemy, selected) < 0)
          )
            selected = enemy;
        return (
          selected?.id === target.id &&
          distance(body, target) <= attackReach(body, target)
        );
      })
    )
      continue;
    const travel = distance(origin, point) / barrel.speed;
    const ready = travel + barrel.spawnDeployTime + goblin.interval;
    if (context.remaining < ready) continue;
    const committed = healthPackets(target, projectiles, areas, entities, ready)
      .filter((packet) => packet.step <= impactSteps(ready))
      .reduce(
        (total, packet) =>
          total + (packet.healing ? -packet.damage : packet.damage),
        0,
      );
    const health = target.hp + (target.shield ?? 0) - committed;
    if (
      health <= 0 ||
      (target.king &&
        !target.active &&
        princesses.length &&
        health > goblin.damage)
    )
      continue;
    // The airborne barrel has no troop bodies to hit until the landing.
    if (
      bodies.some(
        (body) =>
          projectiles.some(
            (p) =>
              p.team !== team &&
              !p.decorative &&
              p.remaining + (p.delay ?? 0) >= travel &&
              p.splash > 0 &&
              (p.damage > 0 || p.stun > 0) &&
              distance(body, { x: p.tx, y: p.ty }) <= p.splash + radius,
          ) ||
          areas.some(
            (area) =>
              area.team !== team &&
              area.remaining >= travel &&
              [
                "freeze",
                "poison",
                "graveyard",
                "lightning",
                "tornado",
                "ice-golem",
              ].includes(area.card) &&
              distance(body, area) <= area.radius + radius,
          ),
      )
    )
      continue;
    let exposure = 0;
    for (const enemy of enemies) {
      if (
        enemy.damage <= 0 ||
        !enemy.active ||
        (enemy.card !== "tower" && CARD_MAP[enemy.card].buildingsOnly)
      )
        continue;
      const covered = bodies.filter(
        (body) =>
          distance(body, enemy) <= attackReach(enemy, body) + enemy.speed,
      ).length;
      if (covered) {
        // A single-target defender fires once; splash can threaten the group.
        const splash = enemy.card !== "tower" && CARD_MAP[enemy.card].splash;
        exposure += (enemy.damage / enemy.interval) * (splash ? covered : 1);
      }
    }
    const survivors = health <= goblin.damage ? 1 : 2;
    const budget = (barrel.spawnCount - survivors + 1) * goblin.hp;
    if (exposure * (barrel.spawnDeployTime + goblin.interval) >= budget)
      continue;
    const score =
      target.kind === "tower" && health <= goblin.damage
        ? 7
        : target.kind === "tower" && health <= goblin.damage * 2
          ? 5
          : target.card === "elixir-collector"
            ? 4.5
            : 3;
    choices.push({ point, target: target.id, score, health, exposure, travel });
  }
  choices.sort(
    (a, b) =>
      b.score - a.score ||
      a.health - b.health ||
      a.exposure - b.exposure ||
      a.travel - b.travel,
  );
  const best = choices[0];
  if (best)
    return { point: best.point, target: best.target, score: best.score };
}
