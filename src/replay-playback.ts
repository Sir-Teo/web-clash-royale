import { Battle, type Replay } from "./game/engine";
import { applySnapshot, snapshot } from "./network/perspective";

/** Rebuild canonical rules first; only the destination needs a display copy. */
export function createReplayPlayback(
  replay: Replay,
  targetTick = 0,
): { battle: Battle; source: Battle | null } {
  const source = new Battle({ replay });
  const target = Number.isFinite(targetTick)
    ? Math.max(0, Math.min(replay.duration, Math.floor(targetTick)))
    : 0;
  while (source.tick < target && !source.winner) source.step();
  if (replay.perspective !== "red") return { battle: source, source: null };
  const battle = new Battle({
    replay: {
      ...replay,
      deck: replay.enemyDeck,
      enemyDeck: replay.deck,
      actions: [],
    },
  });
  applySnapshot(battle, snapshot(source), "red");
  return { battle, source };
}
