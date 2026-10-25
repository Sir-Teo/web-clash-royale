import { CARD_MAP } from "./cards";
import type { CardId } from "./cards";
import type { Point } from "./engine";

export const BUILDING_RADIUS = 0.8;
export const DEPLOY_TIME = 1;

export function deploymentPositions(id: CardId, point: Point): Point[] {
  const count = CARD_MAP[id].count;
  return Array.from({ length: count }, (_, i) => {
    const angle = i * 2.39996,
      spread = count === 1 ? 0 : Math.sqrt(i) * 0.43;
    return {
      x: Math.max(0.6, Math.min(17.4, point.x + Math.cos(angle) * spread)),
      y: Math.max(0.8, Math.min(31.2, point.y + Math.sin(angle) * spread)),
    };
  });
}
