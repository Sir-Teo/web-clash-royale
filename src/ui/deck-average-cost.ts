import { averageCost, CARD_MAP, type CardId } from "../game/cards";

/** Deck previews use Mirror's possible prices rather than its printed one. */
export function deckAverageCostLabel(deck: readonly CardId[]): string {
  if (!deck.includes("mirror")) return averageCost([...deck]).toFixed(1);
  const fixed = deck
    .filter((id) => id !== "mirror")
    .map((id) => CARD_MAP[id].cost);
  if (!fixed.length) return "Variable";
  const total = fixed.reduce((sum, cost) => sum + cost, 0);
  const low = ((total + Math.min(...fixed) + 1) / deck.length).toFixed(1);
  const high = ((total + Math.max(...fixed) + 1) / deck.length).toFixed(1);
  return low === high ? low : `${low}–${high}`;
}
