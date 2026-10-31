import { CARD_MAP, type CardId } from "../game/cards";
import { SOLO_OPPONENTS } from "../game/opponents";

interface PracticeChoice {
  readonly name: string;
  readonly style: string;
  readonly deck: readonly CardId[];
  readonly savedSlot?: number;
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
