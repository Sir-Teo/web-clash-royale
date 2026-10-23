import type { CombatAudioEvent } from "../game/combat-audio-events";
import type { Entity, Point, Team } from "../game/engine";
import { deploymentEffect } from "./destruction";
import type { DeploymentEffect } from "./destruction";

export interface DeploymentBurst {
  effect: DeploymentEffect;
  origin: Point;
  team: Team;
  seed: number;
  age: number;
}

// Reuse per-entity lifecycle events. Card casts alone cannot locate individual
// Archers or summoned Skeletons, and would duplicate feedback on peer snapshots.
export class NativeDeploymentEffects {
  private cursor = 0;
  reset(events: readonly CombatAudioEvent[] = []) {
    this.cursor = events.reduce((last, event) => Math.max(last, event.id), 0);
  }
  consume(
    events: readonly CombatAudioEvent[],
    entities: readonly Entity[],
    seed: number,
    now: number,
  ): DeploymentBurst[] {
    const bursts: DeploymentBurst[] = [];
    for (const event of events) {
      if (event.id <= this.cursor) continue;
      this.cursor = event.id;
      if (event.phase !== "spawn") continue;
      const effect = deploymentEffect(event.profile);
      // Older hosts omit origin. Their still-deploying entity has not moved;
      // beyond that point skip instead of inventing its birth position.
      const actor = event.origin
        ? undefined
        : entities.find((e) => e.id === event.actor && e.deploy > 0);
      const origin = event.origin ?? actor;
      if (!effect || !origin) continue;
      bursts.push({
        effect,
        origin: { x: origin.x, y: origin.y },
        team: event.team,
        seed: seed ^ event.id,
        age: Math.max(0, now - event.time),
      });
    }
    return bursts;
  }
}
