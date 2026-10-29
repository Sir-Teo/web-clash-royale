import type { AreaEffect, Entity, Point, Projectile, Team } from "./engine";
import { CARD_MAP, type CardId } from "./cards";
import {
  deploymentPositions,
  deploymentRadius,
  deploymentTime,
} from "./deployment";
import { deploymentYBounds } from "./placement-bounds";
import { attackReach, NATIVE_RANGE_RADIUS_FACTOR } from "./attack-range";
import { approachingBuildingThreat } from "./building-investment";

export const isArmyCard = (card: CardId) =>
  card === "golem" || card === "lava-hound" || card === "three-musketeers";
interface ArmyContext {
  team: Team;
  rulesVersion: number;
  cards: readonly { id: CardId; played: CardId; cost: number | null }[];
  remaining: number;
  elixir: number;
  elixirRate: number;
  entities: readonly Entity[];
  projectiles: readonly Projectile[];
  areas: readonly AreaEffect[];
  legal: (card: CardId, point: Point) => boolean;
}
export interface ArmyPlan {
  id: CardId;
  point: Point;
  target: number;
  requiredElixir: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Save for a costly push instead of endlessly cycling its cheaper support. */
export function armyPlan(context: ArmyContext): ArmyPlan | undefined {
  if (!context.cards.some((card) => isArmyCard(card.played))) return;
  const { team, entities, projectiles, areas, rulesVersion } = context;
  if (approachingBuildingThreat(team, entities)) return;
  const crowns = entities.filter(
    (entity) =>
      entity.team !== team && entity.kind === "tower" && entity.hp > 0,
  );
  const princesses = crowns.filter((entity) => !entity.king);
  const targets = (princesses.length ? princesses : crowns).sort(
    (a, b) => a.hp - b.hp,
  );
  const choices = context.cards
    .filter((card) => {
      if (!isArmyCard(card.played) || card.cost === null || card.cost > 10)
        return false;
      const unit =
        card.played === "three-musketeers" ? "musketeer" : card.played;
      const existing = entities.filter(
        (entity) =>
          entity.team === team &&
          entity.card === unit &&
          entity.hp > 0 &&
          !entity.clone,
      ).length;
      return (
        existing <
        (card.played === "three-musketeers" ? CARD_MAP[card.played].count : 1)
      );
    })
    .sort((a, b) => a.cost! - b.cost!);
  for (const choice of choices) {
    const requiredElixir = Math.min(10, choice.cost! + 2);
    const missing = Math.max(0, requiredElixir - context.elixir - 1e-6);
    const saving = missing > 0 ? missing / context.elixirRate : 0;
    const unit =
      choice.played === "three-musketeers" ? "musketeer" : choice.played;
    const stats = CARD_MAP[unit],
      radius = deploymentRadius(unit);
    const body = {
      range: stats.range,
      radius,
      rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
    };
    for (const crown of targets) {
      const canonical =
        team === "red" ? crown : { x: 18 - crown.x, y: 32 - crown.y };
      const column = canonical.x;
      for (const y of [9, 11.5, 6.5])
        for (const x of [column, column - 2.5, column + 2.5]) {
          const point =
            team === "red"
              ? { x: Math.max(0.7, Math.min(17.3, x)), y }
              : { x: 18 - Math.max(0.7, Math.min(17.3, x)), y: 32 - y };
          if (!context.legal(choice.played, point)) continue;
          const positions = deploymentPositions(
            choice.played,
            point,
            team,
            undefined,
            rulesVersion,
            undefined,
            deploymentYBounds(choice.played, entities, team, point.x),
          );
          // One attack interval and three seconds for bridge/path overhead are a
          // conservative timing allowance, not a prediction of the whole fight.
          const approach = Math.max(
            ...positions.map(
              (position) =>
                Math.max(
                  0,
                  distance(position, crown) - attackReach(body, crown),
                ) / stats.speed,
            ),
          );
          const ready =
            deploymentTime(choice.played, rulesVersion) +
            approach +
            stats.interval +
            3;
          if (context.remaining < saving + ready) continue;
          if (
            positions.some(
              (position) =>
                projectiles.some(
                  (p) =>
                    p.team !== team &&
                    !p.decorative &&
                    p.remaining > 0 &&
                    p.splash > 0 &&
                    (p.air || !stats.air) &&
                    (p.damage > 0 || p.stun > 0) &&
                    distance(position, { x: p.tx, y: p.ty }) <=
                      p.splash + radius,
                ) ||
                areas.some(
                  (area) =>
                    area.team !== team &&
                    area.remaining > 0 &&
                    [
                      "freeze",
                      "poison",
                      "lightning",
                      "tornado",
                      "ice-golem",
                      ...(!stats.air ? ["graveyard"] : []),
                    ].includes(area.card) &&
                    distance(position, area) <= area.radius + radius,
                ),
            )
          )
            continue;
          // Nine-elixir Three Musketeers keep one, and a ten-elixir Mirror is
          // still payable. Other choices retain the usual two-elixir reserve.
          return {
            id: choice.id,
            point,
            target: crown.id,
            requiredElixir,
          };
        }
    }
  }
}
