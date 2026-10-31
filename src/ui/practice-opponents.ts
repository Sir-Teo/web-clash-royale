import { CARD_MAP, type CardId } from "../game/cards";
import { SOLO_OPPONENTS } from "../game/opponents";

interface PracticeChoice {
  readonly name: string;
  readonly style: string;
  readonly deck: readonly CardId[];
  readonly savedSlot?: number;
}
interface PracticeDeckChoice {
  readonly value: string;
  readonly name: string;
  readonly deck: readonly CardId[];
  readonly opponentIndex: number;
  readonly savedSlot?: number;
}

/** Keep saved slot values stable and expose curated decks as temporary loadouts. */
export function practiceDeckChoices(
  savedDecks: readonly (readonly CardId[])[] = [],
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
): PracticeChoice[] {
  return [
    ...SOLO_OPPONENTS,
    ...savedDecks.map((deck, savedSlot) => ({
      name: `Battle deck ${savedSlot + 1}`,
      style: "Your saved deck",
      deck: [...deck],
      savedSlot,
    })),
  ];
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
      ...opponent.deck.map((id) => CARD_MAP[id].name),
    ].map(searchable);
    return terms.every((term) => fields.some((field) => field.includes(term)))
      ? [{ opponent, index }]
      : [];
  });
}
