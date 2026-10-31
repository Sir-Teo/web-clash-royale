import { CARD_MAP } from "../game/cards";
import { SOLO_OPPONENTS } from "../game/opponents";

const searchable = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Keep roster indexes stable when filtering so the selected deck stays exact. */
export function practiceOpponents(search = "") {
  const terms = search.split(/\s+/u).map(searchable).filter(Boolean);
  return SOLO_OPPONENTS.flatMap((opponent, index) => {
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
