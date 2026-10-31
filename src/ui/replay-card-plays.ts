import type { CardId } from "../game/cards";
import type { Replay } from "../game/engine";
import { buildReplayPlays } from "./replay-plays";

/** Keep a card's recorded commands attached to its canonical team. */
export function replayCardPlays(
  replay: Replay,
  card: CardId,
  side: "viewed" | "opponent" = "viewed",
) {
  const viewed = replay.perspective ?? "blue";
  const team = side === "viewed" ? viewed : viewed === "blue" ? "red" : "blue";
  return buildReplayPlays({
    ...replay,
    actions: replay.actions.filter(
      (action) => action.team === team && action.card === card,
    ),
  });
}
