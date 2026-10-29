import { isPlayableCard } from "../game/playable-cards";
import type { CardId } from "../game/cards";

export interface PeerPlayer {
  name: string;
  deck: CardId[];
}
export function validPeerPlayer(value: unknown): value is PeerPlayer {
  if (!value || typeof value !== "object") return false;
  const p = value as PeerPlayer;
  return (
    typeof p.name === "string" &&
    !!p.name.trim() &&
    p.name.length <= 18 &&
    !/[\u0000-\u001f\u007f]/.test(p.name) &&
    Array.isArray(p.deck) &&
    p.deck.length === 8 &&
    new Set(p.deck).size === 8 &&
    p.deck.every(isPlayableCard)
  );
}
