import definitions from "./screen-shake-data.json";
import type {
  CombatAudioEvent,
  CombatAudioPhase,
} from "../game/combat-audio-events";
import type { Team } from "../game/engine";

interface ShakeCue {
  effect: string;
  delay: number;
  duration: number;
}
type Composition = { components: ShakeCue[]; enemyComponents: ShakeCue[] };
const profiles = definitions.profiles as Record<
  string,
  Partial<Record<CombatAudioPhase, Composition>>
>;
export function screenShakePlan(
  profile: string,
  phase: CombatAudioPhase,
  team: Team,
): readonly ShakeCue[] {
  return (
    profiles[profile]?.[phase]?.[
      team === "red" ? "enemyComponents" : "components"
    ] ?? []
  );
}

/** Native maximum-overlap timer and decaying circular displacement.
 * Cosmetic RNG and the browser art-unit conversion are reconstruction choices.
 */
export class NativeScreenShake {
  private cursor = 0;
  private clock = 0;
  private remaining = 0;
  private random = 0;
  private pending: (ShakeCue & { at: number; seed: number })[] = [];
  private x = 0;
  private y = 0;
  private triggers = 0;
  private lastEffect = "";
  get state() {
    return {
      remaining: this.remaining,
      x: this.x,
      y: this.y,
      triggers: this.triggers,
      lastEffect: this.lastEffect,
    };
  }
  consume(events: readonly CombatAudioEvent[], seed: number, now: number) {
    for (const event of events) {
      if (event.id <= this.cursor) continue;
      this.cursor = event.id;
      for (const cue of screenShakePlan(
        event.profile,
        event.phase,
        event.team,
      )) {
        const at = this.clock + event.time + cue.delay - now;
        if (at + cue.duration <= this.clock) continue;
        this.pending.push({ ...cue, at, seed: seed ^ event.id });
      }
    }
  }
  update(delta: number, reduced = false) {
    if (reduced) {
      this.x = this.y = 0;
      this.pending = [];
      this.remaining = 0;
      return this.state;
    }
    // A paused browser still repaints UI. Hold its last rendered projection
    // instead of executing another native motion step with a zero delta.
    if (delta <= 0) return this.state;
    this.x = this.y = 0;
    const future: typeof this.pending = [];
    for (const cue of this.pending) {
      if (cue.at > this.clock + 1e-8) {
        future.push(cue);
        continue;
      }
      const remaining = cue.duration - Math.max(0, this.clock - cue.at);
      if (remaining > 0) {
        this.triggers++;
        this.lastEffect = cue.effect;
        if (remaining > this.remaining) {
          this.remaining = remaining;
          this.random = cue.seed | 0;
        }
      }
    }
    this.pending = future;
    if (this.remaining > 0) {
      this.random = (Math.imul(this.random, 1664525) + 1013904223) | 0;
      const angle =
        Math.floor(((this.random >>> 0) / 4294967296) * 10000) *
        definitions.angleFactor;
      const radius = this.remaining * definitions.radiusFactor;
      this.x = Math.cos(angle) * radius;
      this.y = Math.sin(angle) * radius;
      this.remaining = Math.max(0, this.remaining - delta);
    }
    this.clock += delta;
    return this.state;
  }
  reset(events: readonly CombatAudioEvent[] = []) {
    this.cursor = events.at(-1)?.id ?? 0;
    this.clock =
      this.remaining =
      this.random =
      this.x =
      this.y =
      this.triggers =
        0;
    this.lastEffect = "";
    this.pending = [];
  }
}
