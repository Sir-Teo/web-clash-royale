import { CARD_MAP, type CardId } from "./cards";
import type { Entity } from "./engine";

/** Tactical value per body for AI decisions, not the card's elixir price.
 * Spawned descendants still attack: each Lava Pup counts as one, and each
 * Golemite as two. Clones retain the value of their original troop body.
 */
export function aiBodyValue(entity: Pick<Entity, "kind" | "card" | "king">): number {
  if (entity.kind === "tower") return entity.king ? 6 : 4;
  if (entity.card === "lava-pup") return 1;
  if (entity.card === "golemite") return 2;
  const card = CARD_MAP[entity.card as CardId];
  return card.cost / card.count;
}
