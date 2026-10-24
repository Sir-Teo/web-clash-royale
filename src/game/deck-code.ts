import type { CardId } from "./cards";
import { validDeck } from "./profile";

export const DECK_CODE_PREFIX = "BRA-DECK-1:";
export const MAX_DECK_CODE_BYTES = 512;

/** Explicit card IDs keep codes stable when the collection grows or reorders. */
export function encodeDeckCode(deck: readonly CardId[]): string {
  if (!validDeck(deck))
    throw new Error("Choose eight different supported cards.");
  return DECK_CODE_PREFIX + deck.join(",");
}
export function decodeDeckCode(text: string): CardId[] {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).byteLength > MAX_DECK_CODE_BYTES
  )
    throw new Error("Choose a deck code of 512 bytes or less.");
  const code = text.trim();
  if (!code.startsWith(DECK_CODE_PREFIX))
    throw new Error(
      "Paste a Browser Arena deck code starting with BRA-DECK-1:.",
    );
  const deck = code
    .slice(DECK_CODE_PREFIX.length)
    .split(",")
    .map((id) => id.trim());
  if (!validDeck(deck))
    throw new Error("Choose a code with eight different supported cards.");
  return [...deck];
}
