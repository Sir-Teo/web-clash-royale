import type { CardId } from "./cards";
import type { Mode } from "./engine";
import { validDeck } from "./profile";
import type { Profile, RecordEntry } from "./profile";

export interface DeckSelection {
  activeDeck: number;
  deck: CardId[];
  decks: CardId[][];
}

export interface PracticeOpponent {
  name: string;
  style: string;
  mode: Mode;
  deck: CardId[];
}

/** Replay decks use canonical teams; history results already use the viewer's side. */
export function recordedDecks(record: RecordEntry) {
  const red = record.replay.perspective === "red";
  return {
    yours: [...(red ? record.replay.enemyDeck : record.replay.deck)],
    opponent: [...(red ? record.replay.deck : record.replay.enemyDeck)],
  };
}

/** A fresh practice faces the viewer's recorded opponent, including red-side guests. */
export function recordedPractice(
  record: RecordEntry,
  mode: Mode = "training",
): PracticeOpponent {
  const deck = recordedDecks(record).opponent;
  if (!validDeck(deck))
    throw new Error("This recording has no valid opponent deck.");
  return {
    name: record.opponent ?? "Royal Trainer",
    style: "Recorded deck",
    mode,
    deck,
  };
}

export function useRecordedDeck(
  profile: Profile,
  record: RecordEntry,
  side: "yours" | "opponent",
  slot: number,
): DeckSelection {
  return useDeck(profile, recordedDecks(record)[side], slot);
}

/** Adopt a validated deck without aliasing the source or another saved slot. */
export function useDeck(
  profile: Profile,
  deck: readonly CardId[],
  slot: number,
): DeckSelection {
  if (
    !validDeck(deck) ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= profile.decks.length
  )
    throw new Error("Choose a valid deck and saved deck slot.");
  const previous = {
    activeDeck: profile.activeDeck,
    deck: [...profile.deck],
    decks: profile.decks.map((deck) => [...deck]),
  };
  profile.decks[profile.activeDeck] = [...profile.deck];
  profile.decks[slot] = [...deck];
  profile.activeDeck = slot;
  profile.deck = [...deck];
  return previous;
}

export function restoreDeckSelection(
  profile: Profile,
  previous: DeckSelection,
) {
  if (
    !validDeck(previous.deck) ||
    previous.decks.length !== 3 ||
    !previous.decks.every(validDeck) ||
    !Number.isInteger(previous.activeDeck) ||
    previous.activeDeck < 0 ||
    previous.activeDeck >= 3
  )
    throw new Error("The previous deck selection is invalid.");
  profile.activeDeck = previous.activeDeck;
  profile.deck = [...previous.deck];
  profile.decks = previous.decks.map((deck) => [...deck]);
}
