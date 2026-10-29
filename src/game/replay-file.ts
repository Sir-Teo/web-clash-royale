import type { Replay } from "./engine";
import { migrateLocalRecord } from "./replay-family";
import { validRecordEntry, type RecordEntry } from "./profile";

export const MAX_REPLAY_BYTES = 512_000;
export interface SharedReplay {
  playerName: string;
  record: RecordEntry;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const name = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);
const invalid = () =>
  new Error(
    "This replay is incomplete or invalid. Choose another replay file.",
  );

export function importReplayFile(text: string): SharedReplay {
  if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_BYTES)
    throw new Error("Choose a replay file smaller than 512 KB.");
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Browser Arena replay.");
  }
  if (
    !object(saved) ||
    saved.format !== "browser-royale-replay" ||
    saved.version !== 1
  )
    throw new Error(
      "Choose a Browser Arena replay file. Progress backups use Restore backup in settings.",
    );
  if (
    !keys(saved, ["format", "version", "playerName", "match"]) ||
    !name(saved.playerName, 18) ||
    !object(saved.match)
  )
    throw invalid();
  const match = saved.match;
  if (
    !keys(match, [
      "date",
      "mode",
      "winner",
      "crowns",
      "opponent",
      "opponentType",
      "practice",
      "replay",
    ]) ||
    typeof match.date !== "string" ||
    match.date.length > 40 ||
    (match.opponent !== undefined && !name(match.opponent, 64)) ||
    !object(match.replay)
  )
    throw invalid();
  const replay = match.replay;
  if (
    !keys(replay, [
      "version",
      "rulesFamily",
      "seed",
      "mode",
      "deck",
      "enemyDeck",
      "actions",
      "duration",
      "perspective",
    ])
  )
    throw invalid();
  const record = migrateLocalRecord(
    {
      ...match,
      playerName: saved.playerName,
      id: Date.parse(match.date),
    },
    true,
  ) as RecordEntry;
  if (
    !validRecordEntry(record) ||
    !record.replay.actions.every(
      (action) =>
        object(action) &&
        keys(action, ["tick", "team", "card", "x", "y"]) &&
        record.replay[action.team === "blue" ? "deck" : "enemyDeck"].includes(
          action.card,
        ) &&
        action.x >= 0.5 &&
        action.x <= 17.5 &&
        action.y >= 0.7 &&
        action.y <= 31.3,
    )
  )
    throw invalid();
  return { playerName: saved.playerName as string, record };
}

/** Whitelist one recording; never include progress, reward totals or room IDs. */
export function exportReplayFile(
  record: RecordEntry,
  playerName: string,
): string {
  const r = record.replay;
  const replay: Replay = {
    version: r.version,
    rulesFamily: r.rulesFamily ?? "origin",
    seed: r.seed,
    mode: r.mode,
    deck: [...r.deck],
    enemyDeck: [...r.enemyDeck],
    actions: r.actions.map(({ tick, team, card, x, y }) => ({
      tick,
      team,
      card,
      x,
      y,
    })),
    duration: r.duration,
    ...(r.perspective ? { perspective: r.perspective } : {}),
  };
  const match = {
    date: record.date,
    mode: record.mode,
    winner: record.winner,
    crowns: [...record.crowns],
    ...(record.opponent !== undefined ? { opponent: record.opponent } : {}),
    ...(record.opponentType !== undefined
      ? { opponentType: record.opponentType }
      : {}),
    ...(record.practice === true ? { practice: true } : {}),
    replay,
  };
  const output = JSON.stringify(
    {
      format: "browser-royale-replay",
      version: 1,
      playerName: record.playerName ?? playerName,
      match,
    },
    null,
    2,
  );
  importReplayFile(output);
  return output;
}
