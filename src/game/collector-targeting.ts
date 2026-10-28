import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { deploymentRadius } from "./deployment";
import {
  approachingBuildingThreat,
  buildingSpellDanger,
} from "./building-investment";
import collector from "./elixir-collector-data.json" with { type: "json" };

interface CollectorContext {
  team: Team;
  elixir: number;
  cost: number;
  remaining: number;
  overtime: boolean;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (point: Point) => boolean;
}

/** Conservative AI economy policy; this does not change Collector mechanics. */
export function collectorTarget(context: CollectorContext): Point | undefined {
  const { team, entities, projectiles, areas, legal } = context;
  // Keep two elixir and enough regulation time for the source lifetime.
  if (
    context.elixir + 1e-6 < context.cost + 2 ||
    context.overtime ||
    context.remaining < collector.lifetime
  )
    return;
  if (
    entities.some(
      (entity) =>
        entity.hp > 0 &&
        entity.team === team &&
        entity.card === "elixir-collector",
    ) ||
    approachingBuildingThreat(team, entities)
  )
    return;
  const structures = entities.filter(
    (entity) =>
      entity.team === team && entity.kind !== "troop" && entity.hp > 0,
  );
  if (!structures.some((entity) => entity.kind === "tower" && entity.king))
    return;
  const radius = deploymentRadius("elixir-collector");
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const candidates = [1.5, 16.5, 4, 14, 6, 12].map((x) =>
    team === "red" ? { x, y: 1.5 } : { x: 18 - x, y: 30.5 },
  );
  // Spread from existing structures to reduce the value of a shared blast.
  return candidates
    .map((point) => ({
      point,
      gap: Math.min(
        ...structures.map((entity) => distance(point, entity) - entity.radius),
      ),
    }))
    .sort((a, b) => b.gap - a.gap)
    .find(
      ({ point }) =>
        legal(point) &&
        !buildingSpellDanger(point, radius, team, projectiles, areas),
    )?.point;
}
