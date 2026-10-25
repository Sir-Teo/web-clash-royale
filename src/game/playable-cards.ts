import { CARDS, type CardId } from "./cards";

// CARD_MAP also contains spawned units, which cannot be selected or played.
const playableCards: ReadonlySet<string> = new Set(
  CARDS.map((card) => card.id),
);
export const isPlayableCard = (value: unknown): value is CardId =>
  typeof value === "string" && playableCards.has(value);
