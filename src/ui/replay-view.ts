import type { Replay } from "../game/engine";
import type { RecordEntry } from "../game/profile";

/** Change display perspective without changing the recording or its owner. */
export function replayView(
  record: Pick<RecordEntry, "replay" | "opponent">,
  playerName: string,
  opponentView = false,
) {
  const opponentName = record.opponent ?? "Royal Trainer";
  const replay: Replay = opponentView
    ? {
        ...record.replay,
        perspective: record.replay.perspective === "red" ? "blue" : "red",
      }
    : record.replay;
  return {
    replay,
    playerName: opponentView ? opponentName : playerName,
    opponentName: opponentView ? playerName : opponentName,
  };
}
