import type { CardId } from "../game/cards";
import type { Mode } from "../game/engine";
import type { RecordEntry } from "../game/profile";
import { recordedDecks } from "../game/match-decks";

const deckKey = (deck: readonly CardId[]) => [...deck].sort().join(",");

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
    if (!record.practice || record.mode !== mode) continue;
    const decks = recordedDecks(record);
    if (deckKey(decks.yours) !== player || deckKey(decks.opponent) !== opponent)
      continue;
    if (record.winner === "blue") result.wins++;
    else if (record.winner === "red") result.losses++;
    else result.draws++;
  }
  return result;
}
