import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { CARD_MAP } from "./cards";
import { deploymentRadius, deploymentTime } from "./deployment";
import { attackReach, NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import { nativeSightRange } from "./sight-range";
import { primaryCandidateVisible } from "./primary-geometry";
import { comparePrimaryTargets } from "./primary-score";
import { healthPackets } from "./status-health";
import { impactSteps } from "./projectile-impacts";
import { approachingBuildingThreat } from "./building-investment";
import miner from "./miner-data.json" with { type: "json" };

interface MinerContext {
  team: Team;
  elixir: number;
  cost: number;
  remaining: number;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (point: Point) => boolean;
}
export interface MinerTarget {
  point: Point;
  target: number;
  score: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Quiet-field tunnel opportunities. This reads current threats, not future AI
 * choices, and never advances combat, clocks or random state. */
export function minerTarget(context: MinerContext): MinerTarget | undefined {
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
  const targets = visible.filter(
    (entity) => entity.kind === "tower" || entity.card === "elixir-collector",
  );
  const radius = deploymentRadius("miner"),
    card = CARD_MAP.miner;
  const body = {
    card: "miner" as const,
    team,
    x: 0,
    y: 0,
    radius,
    range: card.range,
    rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
    sightRange: nativeSightRange({ card: "miner", radius }),
    nativePrimaryScore: true as const,
    nativePrimaryGeometry: true as const,
  };
  const origin = { x: 9, y: team === "red" ? 3 : 29 };
  const candidates: (MinerTarget & {
    exposure: number;
    kingCoverage: number;
    travel: number;
    health: number;
  })[] = [];
  for (const target of targets) {
    const hit =
      target.kind === "tower"
        ? Math.round(card.damage * miner.crownTowerDamageFraction)
        : card.damage;
    for (const ring of [2, 2.5, 3])
      for (let direction = 0; direction < 8; direction++) {
        // Generate in the attacking red view so guest rotation preserves ties.
        const angle = (direction * Math.PI) / 4;
        const canonical =
          team === "red" ? target : { x: 18 - target.x, y: 32 - target.y };
        const x = Math.max(
          0.7,
          Math.min(17.3, canonical.x + Math.cos(angle) * ring),
        );
        const y = Math.max(
          0.7,
          Math.min(31.3, canonical.y + Math.sin(angle) * ring),
        );
        const point = team === "red" ? { x, y } : { x: 18 - x, y: 32 - y };
        Object.assign(body, point);
        if (
          !context.legal(point) ||
          distance(point, target) > attackReach(body, target)
        )
          continue;
        let selected: Entity | undefined;
        for (const enemy of visible)
          if (
            primaryCandidateVisible(body, enemy) &&
            (!selected || comparePrimaryTargets(body, enemy, selected) < 0)
          )
            selected = enemy;
        if (selected?.id !== target.id) continue;
        const travel = distance(origin, point) / miner.travelSpeed;
        const ready = travel + deploymentTime("miner") + card.interval;
        if (context.remaining < ready) continue;
        const committed = healthPackets(
          target,
          projectiles,
          areas,
          entities,
          ready,
        )
          .filter((packet) => packet.step <= impactSteps(ready))
          .reduce(
            (total, packet) =>
              total + (packet.healing ? -packet.damage : packet.damage),
            0,
          );
        const health = target.hp + (target.shield ?? 0) - committed;
        if (health <= 0) continue;
        if (target.king && !target.active && princesses.length && health > hit)
          continue;
        // Miner has no body before arrival. Ignore blasts and areas that end
        // while underground, but avoid known hazards at the landing site.
        if (
          projectiles.some(
            (p) =>
              p.team !== team &&
              !p.decorative &&
              p.remaining + (p.delay ?? 0) >= travel &&
              p.splash > 0 &&
              (p.damage > 0 || p.stun > 0) &&
              distance(point, { x: p.tx, y: p.ty }) <= p.splash + radius,
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
              distance(point, area) <= area.radius + radius,
          )
        )
          continue;
        let exposure = 0,
          kingCoverage = 0;
        for (const enemy of enemies) {
          if (enemy.king && distance(point, enemy) <= attackReach(enemy, body))
            kingCoverage++;
          if (
            enemy.damage <= 0 ||
            !enemy.active ||
            (enemy.card !== "tower" && CARD_MAP[enemy.card].buildingsOnly)
          )
            continue;
          // A nearby moving defender gets one second of reaction allowance.
          if (
            distance(point, enemy) <=
            attackReach(enemy, body) + enemy.speed
          ) {
            exposure += enemy.damage / enemy.interval;
            if (enemy.damage >= card.hp) exposure = Infinity;
          }
        }
        const swings = Math.min(5, Math.ceil(health / hit));
        if (
          exposure * (deploymentTime("miner") + swings * card.interval) >
          card.hp
        )
          continue;
        const score =
          target.kind === "tower" && health <= hit
            ? 8
            : target.kind === "tower" && health <= hit * 3
              ? 5
              : target.card === "elixir-collector"
                ? 4.5
                : 2.5;
        candidates.push({
          point,
          target: target.id,
          score,
          exposure,
          kingCoverage,
          travel,
          health,
        });
      }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.health - b.health ||
      a.exposure - b.exposure ||
      a.kingCoverage - b.kingCoverage ||
      a.travel - b.travel,
  );
  const best = candidates[0];
  if (best)
    return { point: best.point, target: best.target, score: best.score };
}
