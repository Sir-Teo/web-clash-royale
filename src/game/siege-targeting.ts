import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { CARD_MAP, type CardId } from "./cards";
import { deploymentRadius, deploymentTime } from "./deployment";
import { healthPackets } from "./status-health";
import { impactSteps } from "./projectile-impacts";
import {
  attackReach,
  minimumAttackDistance,
  NATIVE_RANGE_RADIUS_FACTOR,
} from "./attack-range";
import { nativeSightRange } from "./sight-range";
import { primaryCandidateVisible } from "./primary-geometry";
import { comparePrimaryTargets } from "./primary-score";
import {
  approachingBuildingThreat,
  buildingSpellDanger,
} from "./building-investment";
import mortar from "./mortar-data.json" with { type: "json" };

export const isSiegeCard = (card: CardId) =>
  card === "x-bow" || card === "mortar";
interface SiegeContext {
  team: Team;
  cards: readonly { id: CardId; played: CardId; cost: number | null }[];
  remaining: number;
  overtime: boolean;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (card: CardId, point: Point) => boolean;
}
export interface SiegePlan {
  id: CardId;
  point: Point;
  target: number;
  requiredElixir: number;
}

/** Current-rule siege geometry; no entities, clocks or RNG are advanced. */
export function siegePlan(context: SiegeContext): SiegePlan | undefined {
  if (!context.cards.some((card) => isSiegeCard(card.played))) return;
  const { team, entities, projectiles, areas, legal } = context;
  if (context.remaining < 12 || approachingBuildingThreat(team, entities))
    return;
  if (
    !entities.some(
      (entity) => entity.team === team && entity.king && entity.hp > 0,
    )
  )
    return;
  const enemies = entities.filter(
    (entity) =>
      entity.team !== team &&
      entity.hp > 0 &&
      !entity.air &&
      !(entity.deploy <= 0 && entity.burrow?.phase === "hidden"),
  );
  const crowns = enemies.filter((entity) => entity.kind === "tower");
  const kingReward = context.overtime
    ? 1
    : 1 + crowns.filter((entity) => !entity.king).length;
  crowns.sort(
    (a, b) =>
      a.hp / (a.king ? kingReward : 1) - b.hp / (b.king ? kingReward : 1),
  );
  const choices = context.cards
    .filter(
      (card) =>
        isSiegeCard(card.played) &&
        card.cost !== null &&
        card.cost + 2 <= 10 &&
        !entities.some(
          (entity) =>
            entity.team === team &&
            entity.card === card.played &&
            entity.hp > 0,
        ),
    )
    .sort((a, b) => a.cost! - b.cost!);
  for (const choice of choices) {
    const radius = deploymentRadius(choice.played);
    const body = {
      card: choice.played,
      team,
      x: 0,
      y: 0,
      radius,
      range: CARD_MAP[choice.played].range,
      rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
      sightRange: nativeSightRange({ card: choice.played, radius }),
      minimumRange:
        choice.played === "mortar" ? mortar.minimumRange : undefined,
      nativePrimaryScore: true as const,
      nativePrimaryGeometry: true as const,
    };
    for (const crown of crowns) {
      // Avoid paying for a target covered by released damage during setup.
      const setup = deploymentTime(choice.played);
      const committed = healthPackets(
        crown,
        projectiles,
        areas,
        entities,
        setup,
      )
        .filter((packet) => packet.step <= impactSteps(setup))
        .reduce(
          (damage, packet) =>
            damage + (packet.healing ? -packet.damage : packet.damage),
          0,
        );
      if (committed >= crown.hp + (crown.shield ?? 0)) continue;
      const column = team === "red" ? crown.x : 18 - crown.x;
      const columns = [
        ...new Set(
          [column, column - 2.5, column + 2.5, 3.5, 14.5].map((x) =>
            Math.max(0.7, Math.min(17.3, x)),
          ),
        ),
      ];
      // The second row is available only after the lane's Princess falls.
      for (const y of [14, 18])
        for (const x of columns) {
          const point = team === "red" ? { x, y } : { x: 18 - x, y: 32 - y };
          Object.assign(body, point);
          const distance = Math.hypot(point.x - crown.x, point.y - crown.y);
          if (
            distance > attackReach(body, crown) ||
            distance < minimumAttackDistance(body, crown) ||
            !legal(choice.played, point) ||
            buildingSpellDanger(point, radius, team, projectiles, areas)
          )
            continue;
          let selected: Entity | undefined;
          for (const enemy of enemies) {
            if (
              Math.hypot(point.x - enemy.x, point.y - enemy.y) <
                minimumAttackDistance(body, enemy) ||
              !primaryCandidateVisible(body, enemy)
            )
              continue;
            if (!selected || comparePrimaryTargets(body, enemy, selected) < 0)
              selected = enemy;
          }
          if (selected?.id === crown.id)
            return {
              id: choice.id,
              point,
              target: crown.id,
              requiredElixir: choice.cost! + 2,
            };
        }
    }
  }
}
