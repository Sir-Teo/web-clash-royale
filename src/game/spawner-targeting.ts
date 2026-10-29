import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import type { CardId } from "./cards";
import { deploymentRadius } from "./deployment";
import {
  approachingBuildingThreat,
  buildingSpellDanger,
} from "./building-investment";

const pressureSpawners = new Set<CardId>([
  "goblin-hut",
  "barbarian-hut",
  "furnace",
]);
interface SpawnerContext {
  team: Team;
  cards: readonly { id: CardId; played: CardId; cost: number | null }[];
  remaining: number;
  overtime: boolean;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (card: CardId, point: Point) => boolean;
}
export interface SpawnerPlan {
  id: CardId;
  card: CardId;
  point: Point;
  requiredElixir: number;
}

/** A quiet-field reinforcement plan can reserve elixir before a hut is affordable. */
export function spawnerPlan(context: SpawnerContext): SpawnerPlan | undefined {
  if (!context.cards.some((card) => pressureSpawners.has(card.played))) return;
  const { team, entities, projectiles, areas, legal } = context;
  if (
    context.overtime ||
    context.remaining < 30 ||
    approachingBuildingThreat(team, entities)
  )
    return;
  if (
    !entities.some(
      (entity) =>
        entity.team === team &&
        entity.kind === "tower" &&
        entity.king &&
        entity.hp > 0,
    )
  )
    return;
  const choices = context.cards
    .filter(
      (card) =>
        card.cost !== null &&
        card.cost + 2 <= 10 &&
        pressureSpawners.has(card.played) &&
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
      if (
        legal(choice.played, point) &&
        !buildingSpellDanger(point, radius, team, projectiles, areas)
      )
        return {
          id: choice.id,
          card: choice.played,
          point,
          requiredElixir: choice.cost! + 2,
        };
    }
  }
}
