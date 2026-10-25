import { CARD_MAP, type CardId } from "./cards";
import { combatTraits } from "./combat";
import { DEPLOY_TIME } from "./deployment";
import type { AreaEffect, Entity, Point, Team } from "./engine";
import rage from "./rage-data.json" with { type: "json" };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Lead a moving building-seeker through the defender's deployment and windup. */
export function meleeInterceptTarget(
  card: CardId,
  team: Team,
  threat: Entity,
  entities: readonly Entity[],
  legal: (point: Point) => boolean,
  areas: readonly AreaEffect[] = [],
): Point | undefined {
  const candidate = CARD_MAP[card],
    traits = combatTraits({ card });
  if (
    candidate.kind !== "troop" ||
    candidate.buildingsOnly ||
    traits.projectile ||
    threat.team === team ||
    threat.kind !== "troop" ||
    threat.card === "tower" ||
    !CARD_MAP[threat.card].buildingsOnly ||
    !threat.active ||
    threat.hp <= 0 ||
    threat.speed <= 0 ||
    (threat.air && !candidate.hitsAir)
  )
    return;
  const targets = entities.filter(
    (e) =>
      e.team === team &&
      e.hp > 0 &&
      e.kind !== "troop" &&
      !(e.deploy <= 0 && e.burrow?.phase === "hidden"),
  );
  const sight = Math.max(combatTraits(threat).sight, threat.range);
  const closest = (a: Entity, b: Entity) =>
    distance(threat, a) - a.radius - (distance(threat, b) - b.radius) ||
    a.id - b.id;
  const current = targets.find((e) => e.id === threat.target);
  const inRange = (target: Entity) =>
    distance(threat, target) <=
    threat.range + target.radius + threat.radius * 0.35;
  if (current && inRange(current)) return;
  const target =
    targets
      .filter((e) => distance(threat, e) <= sight + e.radius)
      .sort(closest)[0] ?? targets.sort(closest)[0];
  if (!target || inRange(target)) return;
  // Match moveToward's routing, including the approach before the river band.
  if (
    !threat.air &&
    threat.card !== "hog-rider" &&
    ((threat.y < 14.8 && target.y > 16) ||
      (threat.y > 17.2 && target.y < 16) ||
      (threat.y >= 14.8 && threat.y <= 17.2))
  )
    return;
  const horizon = DEPLOY_TIME + Math.min(candidate.interval, traits.windup);
  // Deployment and stun count down together, rather than adding their durations.
  const frozen = Math.max(
    0,
    ...areas
      .filter(
        (area) =>
          area.card === "freeze" &&
          area.team !== threat.team &&
          area.remaining > 0 &&
          distance(area, threat) < area.radius + threat.radius,
      )
      .map((area) => area.remaining),
  );
  const wait = Math.max(0, threat.deploy, threat.stun, frozen);
  const moving = Math.max(0, horizon - wait);
  const boosted = Math.min(
    moving,
    Math.max(0, (threat.rage?.remaining ?? 0) - wait),
  );
  const travel = threat.speed * (moving + boosted * (rage.speedMultiplier - 1));
  const gap = distance(threat, target);
  const advance = Math.min(
    travel,
    Math.max(0, gap - threat.range - target.radius - threat.radius * 0.35),
  );
  if (advance <= 0) return;
  const dx = (target.x - threat.x) / gap,
    dy = (target.y - threat.y) / gap;
  const point = { x: threat.x + dx * advance, y: threat.y + dy * advance };
  const radius = candidate.hp > 3000 ? 0.55 : candidate.count > 2 ? 0.25 : 0.37;
  const side = Math.min(
    0.75,
    (candidate.range + threat.radius + radius * 0.35) / 2,
  );
  for (const offset of [0, -side, side]) {
    const placement = { x: point.x - dy * offset, y: point.y + dx * offset };
    if (legal(placement)) return placement;
  }
}
