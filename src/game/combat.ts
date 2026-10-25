import data from "./combat-data.json";
import settings from "./combat-settings.json";
import heal from "./heal-data.json" with { type: "json" };
import rocket from "./rocket-data.json" with { type: "json" };
import type { CardId } from "./cards";
import type { Entity, Point, Team } from "./engine";

export const COMBAT_STEP = 1 / 30;

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
export const SPELL_CROWN_TOWER_DAMAGE_FRACTION = 0.3;
export const ARROWS_WAVES = 3;
export const ARROWS_WAVE_GAP = 0.2;
export const KING_ACTIVATION_TIME = settings.kingActivationSeconds;
// The level-11 Rare conversion, rounded once per source healing tick.
export const HEAL_PER_TICK = Math.round(
  ((heal.sourceHealPerSecond * 1152) / 450) * heal.healInterval,
);

/** Current-rule direct spell travel, shared by casting and AI timing. */
export function directSpellFlight(card: CardId, team: Team, point: Point) {
  const origin = { x: 9, y: team === "blue" ? 30 : 2 };
  const speed =
    card === "rocket"
      ? rocket.speed
      : card === "fireball"
        ? FIREBALL_SPEED
        : ARROWS_SPEED;
  const duration =
    card === "zap"
      ? 0.15
      : Math.max(
          COMBAT_STEP,
          Math.hypot(origin.x - point.x, origin.y - point.y) / speed,
        );
  return { origin, speed, duration };
}
