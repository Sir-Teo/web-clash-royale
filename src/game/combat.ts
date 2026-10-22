import data from "./combat-data.json";
import type { Entity } from "./engine";

export interface CombatTraits {
  source: string;
  windup: number;
  sight: number;
  ignoresKnockback: boolean;
  projectile: {
    source: string;
    speed: number;
    homing: boolean;
    gravity: number;
  } | null;
}

export function combatTraits(e: Pick<Entity, "card" | "king">): CombatTraits {
  const key =
    e.card === "tower" ? (e.king ? "king-tower" : "princess-tower") : e.card;
  return (data as Record<string, CombatTraits>)[key];
}

// Distances in these historical tables use 1,000 units per tile; speeds use 60.
// Preserve curated level-11 damage/health/intervals while reconstructing timing.
export const FIREBALL_SPEED = 600 / 60;
export const FIREBALL_KNOCKBACK = 1800 / 1000;
export const ARROWS_SPEED = 800 / 60;
export const ARROWS_WAVES = 3;
export const ARROWS_WAVE_GAP = 0.2;
