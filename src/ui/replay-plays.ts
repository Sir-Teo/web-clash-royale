import { STEP, type Replay } from "../game/engine";
import { CARD_MAP } from "../game/cards";

export interface ReplayPlay {
  tick: number;
  targetTick: number;
  label: string;
}

/** Group simultaneous commands; seeking one frame later shows their effects.
 * The recorded final tick (including zero) already consumes boundary actions. */
export function buildReplayPlays(replay: Replay): ReplayPlay[] {
  const groups: ReplayPlay[] = [];
  const player = replay.perspective ?? "blue";
  for (const action of replay.actions) {
    const seconds = Math.floor(action.tick * STEP);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const play = `${action.team === player ? "Player" : "Opponent"}: ${CARD_MAP[action.card].name}`;
    const last = groups.at(-1);
    if (last?.tick === action.tick) last.label += ` · ${play}`;
    else
      groups.push({
        tick: action.tick,
        targetTick: Math.min(replay.duration, action.tick + 1),
        label: `${time} · ${play}`,
      });
  }
  return groups;
}

/** Strictly move past the current displayed play, using the latest seek tick. */
export function adjacentReplayPlay(
  plays: readonly ReplayPlay[],
  tick: number,
  direction: -1 | 1,
): ReplayPlay | undefined {
  if (direction === 1) return plays.find((play) => play.targetTick > tick);
  for (let i = plays.length - 1; i >= 0; i--)
    if (plays[i].targetTick < tick) return plays[i];
}
