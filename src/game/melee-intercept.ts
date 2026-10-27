import { attackRadius, attackReach } from "./attack-range";
import { comparePrimaryTargets } from "./primary-score";
import { primaryCandidateVisible } from "./primary-geometry";
import { CARD_MAP, type CardId } from "./cards";
import { combatTraits } from "./combat";
import { deploymentRadius, deploymentTime } from "./deployment";
import type { AreaEffect, Entity, Point, Team } from "./engine";
import iceWizard from "./ice-wizard-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };
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
  const closest = (a: Entity, b: Entity) =>
    distance(threat, a) - a.radius - (distance(threat, b) - b.radius) ||
    a.id - b.id;
  const nearbyClosest = threat.nativePrimaryScore
    ? (a: Entity, b: Entity) => comparePrimaryTargets(threat, a, b)
    : closest;
  const current = targets.find((e) => e.id === threat.target);
  const inRange = (target: Entity) =>
    distance(threat, target) <=
    attackReach(threat, target);
  if (current && inRange(current)) return;
  const target =
    targets
      .filter((e) => primaryCandidateVisible(threat, e))
      .sort(nearbyClosest)[0] ?? targets.sort(closest)[0];
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
  const horizon = deploymentTime(card) + Math.min(candidate.interval, traits.windup);
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
  const rageUntil = Math.max(0, (threat.rage?.remaining ?? 0) - wait);
  const slowUntil = Math.max(0, (threat.slow?.remaining ?? 0) - wait);
  const distanceCharge = threat.card === "battle-ram" &&
    threat.chargeDistance !== undefined;
  const chargeAt = threat.card === "battle-ram" && !distanceCharge
    ? Math.max(0, battleRam.chargeRange - threat.move) : Infinity;
  // Integrate only changes in the current movement modifiers, bounded by the
  // deployment horizon. No entities or simulation clocks are advanced.
  const boundaries = [...new Set([0, moving, rageUntil, slowUntil, chargeAt]
    .filter((time) => time >= 0 && time <= moving))].sort((a, b) => a - b);
  let travel = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1], end = boundaries[i];
    const middle = (start + end) / 2;
    if (distanceCharge) {
      const speed = threat.speed *
        (middle < rageUntil ? rage.speedMultiplier : 1) *
        (middle < slowUntil ? iceWizard.speedMultiplier : 1);
      const remaining = Math.max(0,
        battleRam.chargeRange - threat.chargeDistance! - travel);
      const walking = Math.min(end - start, remaining / speed);
      travel += speed * walking + speed * battleRam.chargeSpeedMultiplier *
        (end - start - walking);
    } else {
      travel += threat.speed * (end - start) *
        (middle < rageUntil ? rage.speedMultiplier : 1) *
        (middle < slowUntil ? iceWizard.speedMultiplier : 1) *
        (middle > chargeAt ? battleRam.chargeSpeedMultiplier : 1);
    }
  }
  const gap = distance(threat, target);
  const advance = Math.min(
    travel,
    Math.max(0, gap - threat.range - target.radius - attackRadius(threat)),
  );
  if (advance <= 0) return;
  const dx = (target.x - threat.x) / gap,
    dy = (target.y - threat.y) / gap;
  const point = { x: threat.x + dx * advance, y: threat.y + dy * advance };
  const radius = deploymentRadius(card);
  const side = Math.min(
    0.75,
    (candidate.range + threat.radius + attackRadius({ radius, rangeRadiusFactor: threat.rangeRadiusFactor })) / 2,
  );
  for (const offset of [0, -side, side]) {
    const placement = { x: point.x - dy * offset, y: point.y + dx * offset };
    if (legal(placement)) return placement;
  }
}
