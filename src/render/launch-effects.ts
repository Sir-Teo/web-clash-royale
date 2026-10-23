import type { CombatAudioEvent } from "../game/combat-audio-events";
import type { Point, Team } from "../game/engine";
import { launchEffect } from "./destruction";
import type { LaunchEffect } from "./destruction";

export interface LaunchBurst {
  effect: LaunchEffect;
  origin: Point;
  team: Team;
  seed: number;
  age: number;
}

// Launch audio already has its own presentation ID. Its source position is
// immutable, so snapshots can deliver a muzzle flash after the shooter moves.
export class NativeLaunchEffects {
  private cursor = 0;
  reset(events: readonly CombatAudioEvent[] = []) {
    this.cursor = events.reduce((last, event) => Math.max(last, event.id), 0);
  }
  consume(
    events: readonly CombatAudioEvent[],
    seed: number,
    now: number,
  ): LaunchBurst[] {
    const bursts: LaunchBurst[] = [];
    for (const event of events) {
      if (event.id <= this.cursor) continue;
      this.cursor = event.id;
      if (event.phase !== "launch" || !event.origin) continue;
      const effect = launchEffect(event.profile);
      if (!effect) continue;
      bursts.push({
        effect,
        origin: event.origin,
        team: event.team,
        seed: seed ^ event.id,
        age: Math.max(0, now - event.time),
      });
    }
    return bursts;
  }
}
