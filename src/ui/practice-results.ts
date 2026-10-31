import type { CardId } from "../game/cards";
import type { Mode } from "../game/engine";
import type { RecordEntry } from "../game/profile";
import { recordedDecks } from "../game/match-decks";

const deckKey = (deck: readonly CardId[]) => [...deck].sort().join(",");

function matchesPractice(
  record: RecordEntry,
  player: string,
  opponent: string,
  mode: Mode,
) {
  if (!record.practice || record.mode !== mode) return false;
  const decks = recordedDecks(record);
  return (
    deckKey(decks.yours) === player && deckKey(decks.opponent) === opponent
  );
}

/** Compare compositions from the recorded viewer's side, at the selected pace. */
export function practiceResults(
  history: readonly RecordEntry[],
  playerDeck: readonly CardId[],
  opponentDeck: readonly CardId[],
  mode: Mode,
) {
  const player = deckKey(playerDeck);
  const opponent = deckKey(opponentDeck);
  const result = { wins: 0, losses: 0, draws: 0 };
  for (const record of history) {
    if (!matchesPractice(record, player, opponent, mode)) continue;
    if (record.winner === "blue") result.wins++;
    else if (record.winner === "red") result.losses++;
    else result.draws++;
  }
  return result;
}

/** Review the newest matching recording, keeping its original viewing side. */
export function latestPracticeRecord(
  history: readonly RecordEntry[],
  playerDeck: readonly CardId[],
  opponentDeck: readonly CardId[],
  mode: Mode,
) {
  const player = deckKey(playerDeck);
  const opponent = deckKey(opponentDeck);
  let latest: RecordEntry | undefined;
  for (const record of history) {
    if (!matchesPractice(record, player, opponent, mode)) continue;
    if (!latest || Date.parse(record.date) > Date.parse(latest.date))
      latest = record;
  }
  return latest;
}
