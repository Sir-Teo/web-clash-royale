import { other, type Battle, type Replay, type Team } from "./engine";

export function replayComplete(
  battle: Pick<Battle, "tick" | "winner">,
  replay: Pick<Replay, "duration">,
): boolean {
  return !!battle.winner || battle.tick >= replay.duration;
}

/** History results use the recorded viewer's side. Finish the canonical engine
 * before projecting it, so its event allocator and winner remain authoritative.
 * A natural combat outcome always wins over recording metadata.
 */
export function completeRecordedReplay(
  source: Battle,
  replay: Pick<Replay, "duration" | "perspective">,
  winner: Team | "draw",
): boolean {
  if (source.winner || source.tick < replay.duration) return false;
  const canonical =
    winner !== "draw" && replay.perspective === "red" ? other(winner) : winner;
  source.finish(canonical, "Replay complete");
  return true;
}
