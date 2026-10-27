import { attackReach } from "./attack-range";
import { comparePrimaryTargets } from "./primary-score";
import { acquisitionSight } from "./sight-range";
import { CARD_MAP, type CardId } from "./cards";
import { deploymentRadius } from "./deployment";
import type { Entity, Point, Team } from "./engine";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** A legal ground-only building that can intercept an aerial building-seeker. */
export function buildingLureTarget(
  card: CardId,
  team: Team,
  threat: Entity,
  entities: readonly Entity[],
  legal: (point: Point) => boolean,
): Point | undefined {
  const candidate = CARD_MAP[card];
  if (
    candidate.kind !== "building" ||
    candidate.hitsAir ||
    threat.team === team ||
    threat.hp <= 0 ||
    threat.kind !== "troop" ||
    !threat.air ||
    threat.card === "tower" ||
    !CARD_MAP[threat.card].buildingsOnly
  )
    return;
  const visible = entities.filter(
    (e) =>
      e.team === team &&
      e.hp > 0 &&
      e.kind !== "troop" &&
      !(e.deploy <= 0 && e.burrow?.phase === "hidden"),
  );
  const current = visible.find((e) => e.id === threat.target);
  // Combat retains an engaged target. Do not buy a second existing lure.
  if (
    current &&
    (current.kind === "building" ||
      distance(threat, current) <=
        attackReach(threat, current))
  )
    return;
  const crownDistance = Math.min(
    ...visible
      .filter((e) => e.kind === "tower")
      .map((e) => distance(threat, e) - e.radius),
  );
  if (!Number.isFinite(crownDistance)) return;
  const crowns = visible.filter((entity) => entity.kind === "tower");
  const closerThanCrowns = (target: Point & { radius: number }) => threat.nativePrimaryScore
    ? crowns.every((crown) => comparePrimaryTargets(threat, target, crown) < 0)
    : distance(threat, target) - target.radius < crownDistance;
  const radius = deploymentRadius(card);
  const sight = acquisitionSight(threat);
  if (
    visible.some(
      (e) =>
        e.kind === "building" &&
        distance(threat, e) <= sight + e.radius &&
        closerThanCrowns(e),
    )
  )
    return;
  for (const [dx, dy] of [
    [0, 0],
    [-2.5, 0],
    [2.5, 0],
    [0, -2.5],
    [-2.5, -2.5],
    [2.5, -2.5],
  ]) {
    const point =
      team === "red" ? { x: 9 + dx, y: 10 + dy } : { x: 9 - dx, y: 22 - dy };
    const gap = distance(threat, point);
    // Strictly closer: equal candidate scores retain the existing Crown Tower.
    if (
      gap <= sight + radius &&
      closerThanCrowns({ ...point, radius }) &&
      legal(point)
    )
      return point;
  }
}
