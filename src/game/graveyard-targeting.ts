import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { CARD_MAP, type CardId } from "./cards";
import { deploymentRadius } from "./deployment";
import { attackReach, NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import { approachingBuildingThreat } from "./building-investment";
import { healthPackets } from "./status-health";
import { impactSteps } from "./projectile-impacts";
import primary from "./primary-score-data.json" with { type: "json" };
import graveyard from "./graveyard-data.json" with { type: "json" };

interface GraveyardContext {
  team: Team;
  cards: readonly { id: CardId; played: CardId; cost: number | null }[];
  remaining: number;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (card: CardId, point: Point) => boolean;
}
export interface GraveyardPlan {
  id: CardId;
  point: Point;
  target: number;
  requiredElixir: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Plan over the entire possible spawn disk, without inspecting its RNG stream. */
export function graveyardPlan(
  context: GraveyardContext,
): GraveyardPlan | undefined {
  if (!context.cards.some((card) => card.played === "graveyard")) return;
  const { team, entities, projectiles, areas } = context;
  // Allow the source duration plus walking/deployment time before investing.
  if (
    context.remaining < graveyard.duration + 5 ||
    approachingBuildingThreat(team, entities) ||
    areas.some(
      (area) =>
        area.team === team && area.card === "graveyard" && area.remaining > 0,
    )
  )
    return;
  const enemies = entities.filter(
    (entity) => entity.team !== team && entity.hp > 0,
  );
  const visible = enemies.filter(
    (entity) =>
      !entity.air && !(entity.deploy <= 0 && entity.burrow?.phase === "hidden"),
  );
  const princesses = visible.filter(
    (entity) => entity.kind === "tower" && !entity.king,
  );
  const crowns = princesses.length
    ? princesses
    : visible.filter((entity) => entity.kind === "tower");
  crowns.sort((a, b) => a.hp - b.hp);
  const choices = context.cards
    .filter(
      (card) =>
        card.played === "graveyard" &&
        card.cost !== null &&
        card.cost + 2 <= 10,
    )
    .sort((a, b) => a.cost! - b.cost!);
  const skeleton = CARD_MAP.skeletons,
    radius = deploymentRadius("skeletons");
  const body = {
    radius,
    range: skeleton.range,
    rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
  };
  for (const choice of choices)
    for (const crown of crowns) {
      const canonical =
        team === "red" ? crown : { x: 18 - crown.x, y: 32 - crown.y };
      const center = crown.king
        ? canonical
        : { x: canonical.x < 9 ? 0.7 : 17.3, y: canonical.y - 1 };
      const point =
        team === "red"
          ? { x: center.x, y: center.y }
          : { x: 18 - center.x, y: 32 - center.y };
      if (
        !context.legal(choice.played, point) ||
        distance(point, crown) > graveyard.radius
      )
        continue;
      // Squared-distance score differences are affine over a disk. Bound their
      // minimum, including source target bias and the King's extra sight radius.
      // Arena clamping keeps each child inside this disk because its center is
      // itself in bounds. Edge sites also keep every Princess spawn in her lane.
      if (
        visible.some((enemy) => {
          if (enemy.id === crown.id) return false;
          const gap =
            distance(point, enemy) ** 2 -
            distance(point, crown) ** 2 -
            ((enemy.targetScoreBias ?? 0) - (crown.targetScoreBias ?? 0)) /
              primary.sourceUnitsPerTile ** 2 -
            2 * graveyard.radius * distance(enemy, crown);
          const sum =
            distance(point, enemy) +
            distance(point, crown) +
            2 * graveyard.radius;
          return gap <= (Math.max(0, enemy.radius - crown.radius) + 0.1) * sum;
        })
      )
        continue;
      // Guarded disks are poor investments; towers are the intended pressure.
      if (
        enemies.some(
          (enemy) =>
            enemy.kind !== "tower" &&
            enemy.active &&
            enemy.damage > 0 &&
            !CARD_MAP[enemy.card as CardId].buildingsOnly &&
            distance(point, enemy) <=
              graveyard.radius + attackReach(enemy, body) + enemy.speed,
        )
      )
        continue;
      if (
        projectiles.some(
          (p) =>
            p.team !== team &&
            !p.decorative &&
            p.splash > 0 &&
            (p.damage > 0 || p.stun > 0) &&
            p.remaining + (p.delay ?? 0) >= graveyard.spawnInitialDelay &&
            distance(point, { x: p.tx, y: p.ty }) <=
              graveyard.radius + p.splash + radius,
        ) ||
        areas.some(
          (area) =>
            area.team !== team &&
            area.remaining >= graveyard.spawnInitialDelay &&
            [
              "freeze",
              "poison",
              "graveyard",
              "lightning",
              "tornado",
              "ice-golem",
            ].includes(area.card) &&
            distance(point, area) <= graveyard.radius + area.radius + radius,
        )
      )
        continue;
      const walk =
        Math.max(
          0,
          distance(point, crown) + graveyard.radius - attackReach(body, crown),
        ) / skeleton.speed;
      const setup =
        graveyard.spawnInitialDelay +
        graveyard.spawnDeployTime +
        walk +
        skeleton.interval;
      const committed = healthPackets(
        crown,
        projectiles,
        areas,
        entities,
        setup,
      )
        .filter((packet) => packet.step <= impactSteps(setup))
        .reduce(
          (total, packet) =>
            total + (packet.healing ? -packet.damage : packet.damage),
          0,
        );
      if (committed >= crown.hp + (crown.shield ?? 0)) continue;
      return {
        id: choice.id,
        point,
        target: crown.id,
        requiredElixir: choice.cost! + 2,
      };
    }
}
