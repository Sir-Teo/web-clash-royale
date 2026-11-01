import { SOLO_OPPONENTS } from "../game/opponents";
import type { PracticeOpponent } from "../game/match-decks";
import type { RecordEntry } from "../game/profile";

/** One captured UTC day selects a reproducible curated matchup and opening. */
export function dailyPractice(date = new Date()): {
  day: string;
  playerStyle: string;
  opponentStyle: string;
  practice: PracticeOpponent;
} {
  const day = date.toISOString().slice(0, 10);
  let hash = 2166136261;
  for (const char of day)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const seed = hash & 0x7fffffff || 1;
  const count = SOLO_OPPONENTS.length;
  const playerIndex = seed % count;
  const opponentIndex =
    (playerIndex + 1 + (Math.floor(seed / count) % (count - 1))) % count;
  const player = SOLO_OPPONENTS[playerIndex];
  const opponent = SOLO_OPPONENTS[opponentIndex];
  return {
    day,
    playerStyle: player.style,
    opponentStyle: opponent.style,
    practice: {
      name: `${opponent.name} · ${day}`,
      style: "Daily practice",
      mode: "classic",
      deck: [...opponent.deck],
      playerDeck: [...player.deck],
      openingSeed: seed,
      selection: { playerChoice: `curated:${playerIndex}`, opponentIndex },
    },
  };
}

/** Recognize an unchanged daily matchup using existing recording metadata. */
export function recordedDailyDate(record: RecordEntry): string | undefined {
  const replay = record.replay;
  if (
    !record.practice ||
    record.opponentType !== "ai" ||
    record.mode !== "classic" ||
    replay.mode !== "classic" ||
    replay.rulesFamily === "local" ||
    replay.version < 56 ||
    replay.perspective === "red"
  )
    return;
  const day = record.opponent?.match(/ · (\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!day || day.startsWith("0000")) return;
  const date = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return;
  const { practice } = dailyPractice(date);
  const sameDeck = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length &&
    actual.every((card, index) => card === expected[index]);
  if (
    record.opponent === practice.name &&
    replay.seed === practice.openingSeed &&
    sameDeck(replay.deck, practice.playerDeck!) &&
    sameDeck(replay.enemyDeck, practice.deck)
  )
    return day;
}

/** Summarize only saved attempts of the exact daily matchup and opening. */
export function dailyPracticeResults(
  history: readonly RecordEntry[],
  day: string,
) {
  const result = {
    wins: 0,
    losses: 0,
    draws: 0,
    latest: undefined as RecordEntry | undefined,
  };
  for (const record of history) {
    if (recordedDailyDate(record) !== day) continue;
    if (record.winner === "blue") result.wins++;
    else if (record.winner === "red") result.losses++;
    else result.draws++;
    if (
      !result.latest ||
      Date.parse(record.date) > Date.parse(result.latest.date)
    )
      result.latest = record;
  }
  return result;
}
