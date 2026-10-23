import type { CardId } from "./cards";
import type { Entity, Team } from "./engine";

export type AudioProfile = CardId | "king-tower" | "princess-tower";
export type CombatAudioPhase =
  "attack" | "launch" | "impact" | "cast" | "cancel";
export interface CombatAudioEvent {
  id: number;
  time: number;
  phase: CombatAudioPhase;
  team: Team;
  profile: AudioProfile;
  actor?: number;
  attack?: number;
}
export const audioProfile = (
  entity: Pick<Entity, "card" | "king">,
): AudioProfile =>
  entity.card === "tower"
    ? entity.king
      ? "king-tower"
      : "princess-tower"
    : entity.card;
