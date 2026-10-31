import { CARD_MAP } from "../game/cards";
import type { Mode } from "../game/engine";
import type { RecordEntry } from "../game/profile";

export interface HistoryQuery {
  search: string;
  result: RecordEntry["winner"] | "all";
  mode: Mode | "all";
  type: "all" | "ai" | "friend" | "practice";
}

const battleType = (record: RecordEntry) =>
  record.practice
    ? "practice"
    : (record.opponentType ??
      // Before named AI opponents, only friendly records stored a name/room.
      (record.opponent || record.matchId ? "friend" : "ai"));

// Keep names in every script; ignore accents, spacing and card punctuation.
const searchable = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Keep original positions: filtered rows must still open the correct recording. */
export function historyMatches(
  history: readonly RecordEntry[],
  {
    search = "",
    result = "all",
    mode = "all",
    type = "all",
  }: Partial<HistoryQuery> = {},
) {
  const terms = search.split(/\s+/u).map(searchable).filter(Boolean);
  return history.flatMap((record, index) => {
    if (
      (result !== "all" && record.winner !== result) ||
      (mode !== "all" && record.mode !== mode) ||
      (type !== "all" && battleType(record) !== type)
    )
      return [];
    const fields = [
      record.playerName ?? "",
      record.opponent ?? "Royal Trainer",
      ...record.replay.deck.map((id) => CARD_MAP[id].name),
      ...record.replay.enemyDeck.map((id) => CARD_MAP[id].name),
    ].map(searchable);
    return terms.every((term) => fields.some((field) => field.includes(term)))
      ? [{ record, index }]
      : [];
  });
}
