import tower from "./inferno-tower-data.json" with { type: "json" };
import dragon from "./inferno-dragon-data.json" with { type: "json" };

export type InfernoCard = "inferno-tower" | "inferno-dragon";
export const infernoProfile = (card: InfernoCard) =>
  card === "inferno-tower" ? tower : dragon;

/** Current roster normalization, shared by spawning, beam hits and card details. */
export function infernoDamage(card: InfernoCard, stage: 0 | 1 | 2) {
  const scale = card === "inferno-tower" ? 1152 / 450 : 1.1 ** 2;
  return Math.round(infernoProfile(card).sourceDamage[stage] * scale);
}
