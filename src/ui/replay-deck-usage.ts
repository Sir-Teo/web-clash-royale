import type { Action, Team } from "../game/engine";
import type { CardId } from "../game/cards";

export interface DeckUsage {
  readonly total: number;
  readonly byCard: ReadonlyMap<CardId, number>;
}

/** Count accepted canonical plays; the replay simulation owns tick boundaries. */
export function replayDeckUsage(
  actions: readonly Action[],
  perspective: Team = "blue",
): { viewed: DeckUsage; opponent: DeckUsage } {
  const blue = { total: 0, byCard: new Map<CardId, number>() };
  const red = { total: 0, byCard: new Map<CardId, number>() };
  for (const action of actions) {
    const usage = action.team === "blue" ? blue : red;
    usage.total++;
    usage.byCard.set(action.card, (usage.byCard.get(action.card) ?? 0) + 1);
  }
  return perspective === "red"
    ? { viewed: red, opponent: blue }
    : { viewed: blue, opponent: red };
}
