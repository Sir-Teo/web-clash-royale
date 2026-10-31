import { CARD_MAP, type CardId } from "../game/cards";
import { SOLO_OPPONENTS } from "../game/opponents";
import type { PracticeOpponent, PracticeSourceDeck } from "../game/match-decks";

interface PracticeChoice {
  readonly name: string;
  readonly style: string;
  readonly deck: readonly CardId[];
  readonly savedSlot?: number;
  readonly previous?: true;
}
interface PracticeDeckChoice {
  readonly value: string;
  readonly name: string;
  readonly deck: readonly CardId[];
  readonly opponentIndex: number;
  readonly savedSlot?: number;
  readonly previous?: true;
}

/** Keep saved slot values stable and expose curated decks as temporary loadouts. */
export function practiceDeckChoices(
  savedDecks: readonly (readonly CardId[])[] = [],
  previousDeck?: PracticeSourceDeck,
): PracticeDeckChoice[] {
  return [
    ...savedDecks.map((deck, savedSlot) => ({
      value: String(savedSlot),
      name: `Battle deck ${savedSlot + 1}`,
      deck: [...deck],
      opponentIndex: SOLO_OPPONENTS.length + savedSlot,
      savedSlot,
    })),
    ...SOLO_OPPONENTS.map((opponent, index) => ({
      value: `curated:${index}`,
      name: opponent.style,
      deck: [...opponent.deck],
      opponentIndex: index,
    })),
    ...(previousDeck
      ? [
          {
            value: "previous",
            name: previousDeck.name,
            deck: [...previousDeck.deck],
            opponentIndex: SOLO_OPPONENTS.length + savedDecks.length,
            previous: true as const,
          },
        ]
      : []),
  ];
}

/** Exchange source identities even when two choices contain the same cards. */
export function swapPracticeDecks(
  choices: readonly PracticeDeckChoice[],
  playerValue: string,
  opponentIndex: number,
) {
  const player = choices.find((choice) => choice.value === playerValue);
  const opponent = choices.find(
    (choice) => choice.opponentIndex === opponentIndex,
  );
  return player && opponent
    ? { playerChoice: opponent.value, opponentIndex: player.opponentIndex }
    : null;
}

/** Visit-scoped snapshots keep saved opponent decks separate from profile edits. */
export function practiceRoster(
  savedDecks: readonly (readonly CardId[])[] = [],
  previousDeck?: PracticeSourceDeck,
): PracticeChoice[] {
  return [
    ...SOLO_OPPONENTS,
    ...savedDecks.map((deck, savedSlot) => ({
      name: `Battle deck ${savedSlot + 1}`,
      style: "Your saved deck",
      deck: [...deck],
      savedSlot,
    })),
    ...(previousDeck
      ? [
          {
            ...previousDeck,
            deck: [...previousDeck.deck],
            previous: true as const,
          },
        ]
      : []),
  ];
}

/** Keep a captured matchup available when its source is outside the regular picker. */
export function continuedPracticeChoices(
  practice: PracticeOpponent,
  savedDecks: readonly (readonly CardId[])[],
  activeDeck: number,
) {
  const roster = practiceRoster(savedDecks);
  const matching = roster.findIndex(
    (entry) =>
      entry.deck.length === practice.deck.length &&
      entry.deck.every((id, index) => id === practice.deck[index]),
  );
  const previous =
    practice.selection?.previousDeck ?? (matching < 0 ? practice : undefined);
  return {
    playerChoice: practice.selection?.playerChoice ?? String(activeDeck),
    opponentIndex:
      practice.selection?.opponentIndex ??
      (matching < 0 ? roster.length : matching),
    previousDeck: previous
      ? { name: previous.name, style: previous.style, deck: [...previous.deck] }
      : undefined,
  };
}

const searchable = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Keep roster indexes stable when filtering so the selected deck stays exact. */
export function practiceOpponents(
  search = "",
  opponents: readonly PracticeChoice[] = SOLO_OPPONENTS,
) {
  const terms = search.split(/\s+/u).map(searchable).filter(Boolean);
  return opponents.flatMap((opponent, index) => {
    const fields = [
      opponent.name,
      opponent.style,
      opponent.previous ? "Previous practice" : "",
      ...opponent.deck.map((id) => CARD_MAP[id].name),
    ].map(searchable);
    return terms.every((term) => fields.some((field) => field.includes(term)))
      ? [{ opponent, index }]
      : [];
  });
}
