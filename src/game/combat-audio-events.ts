import type { CardId } from "./cards";
import type { Entity, Point, Team } from "./engine";

export type AudioProfile = CardId | "king-tower" | "princess-tower";
export type CombatAudioPhase =
  | "attack"
  | "launch"
  | "impact"
  | "impact-special"
  | "cast"
  | "cancel"
  | "spawn"
  | "summon"
  | "appear"
  | "hide"
  | "load-1"
  | "load-2"
  | "load-3"
  | "load-ready"
  | "death-impact"
  | "death-spawn"
  | "death";
export interface CombatAudioEvent {
  id: number;
  time: number;
  phase: CombatAudioPhase;
  team: Team;
  profile: AudioProfile;
  actor?: number;
  attack?: number;
  pitchMultiplier?: number;
  // Optional presentation metadata anchors birth dust and muzzle effects even
  // if a coalesced snapshot arrives after the actor has moved or died.
  origin?: Point;
}
export const audioProfile = (
  entity: Pick<Entity, "card" | "king">,
): AudioProfile =>
  entity.card === "tower"
    ? entity.king
      ? "king-tower"
      : "princess-tower"
    : entity.card;

// Older browser clients only understand the original attack phases.
export const isLifecycleAudio = (event: CombatAudioEvent) =>
  event.phase === "spawn" ||
  event.phase === "summon" ||
  event.phase === "appear" ||
  event.phase === "hide" ||
  event.phase === "death-impact" ||
  event.phase === "death-spawn" ||
  event.phase === "impact-special" ||
  event.phase === "death";
