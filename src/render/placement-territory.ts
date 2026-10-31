import { CARD_MAP, type CardId } from "../game/cards";

/** Territory shading in the local blue view; occupied buildings are separate. */
export function placementTerritory(id: CardId | null, enemyPrincess: boolean) {
  if (!id) return { blockedUntil: 0, river: false };
  if (id === "log") return { blockedUntil: 17.5, river: false };
  if (CARD_MAP[id].kind === "spell") return { blockedUntil: 0, river: false };
  return {
    blockedUntil: id === "miner" ? 0 : enemyPrincess ? 17.8 : 11.5,
    river: true,
  };
}
