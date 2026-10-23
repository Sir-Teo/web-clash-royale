import definitions from "./combat-audio-data.json";
import type { GameAudio } from "./audio";
import type { Team } from "./engine";
import type { CombatAudioEvent, CombatAudioPhase } from "./combat-audio-events";

type Profile = keyof typeof definitions.profiles;
type Sound = keyof typeof definitions.sounds;
export interface CombatCue {
  group: string;
  file: string;
  delay: number;
  volume: number;
  pitch: number;
  maximum: number;
  repeat: number;
}
export function combatAudioPlan(
  profile: string,
  phase: CombatAudioPhase,
  seed: number,
  team: Team = "blue",
): CombatCue[] {
  if (
    phase === "cancel" ||
    phase === "death" ||
    !Object.hasOwn(definitions.profiles, profile)
  )
    return [];
  const components =
    definitions.profiles[profile as Profile][phase]?.[
      team === "red" ? "enemyComponents" : "components"
    ];
  if (!Array.isArray(components)) return [];
  let state = seed | 0;
  // Nearby event IDs must not select the same voice throughout a battle.
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  const between = (range: number[]) =>
    range[0] + random() * (range[1] - range[0]);
  return components.flatMap((component) => {
    const variants = definitions.sounds[component.sound as Sound];
    const sound = variants[Math.floor(random() * variants.length)];
    if (!sound.file) return [];
    return [
      {
        group: component.sound,
        file: sound.file,
        delay: component.delay + between(sound.startDelay),
        volume: between(sound.volume) * 0.35,
        pitch: between(sound.pitch),
        maximum: sound.maximum,
        repeat: sound.repeat,
      },
    ];
  });
}

/** Presentation-only scheduling: source delays use the shared match clock. */
export class NativeCombatAudio {
  private cursor = 0;
  private pending: (CombatCue & {
    time: number;
    attack?: number;
    owner?: number;
  })[] = [];
  private lastPlayed = new Map<string, number>();
  constructor(private readonly audio: Pick<GameAudio, "enabled" | "play">) {}
  consume(events: readonly CombatAudioEvent[], seed: number, now: number) {
    for (const event of events) {
      if (event.id <= this.cursor) continue;
      this.cursor = event.id;
      if (event.phase === "death") {
        if (event.actor !== undefined)
          this.pending = this.pending.filter(
            (cue) => cue.owner !== event.actor,
          );
        continue;
      }
      if (event.phase === "cancel") {
        if (event.attack !== undefined)
          this.pending = this.pending.filter(
            (cue) => cue.attack !== event.attack,
          );
        continue;
      }
      const age = now - event.time;
      if (!this.audio.enabled || age > (event.phase === "spawn" ? 4 : 0.5))
        continue;
      // Deployment feedback is infrequent and must survive a short UI stall.
      // Shift the whole composition together so its follow-up keeps its spacing.
      const origin = event.phase === "spawn" && age > 0.5 ? now : event.time;
      for (const cue of combatAudioPlan(
        event.profile,
        event.phase,
        seed ^ event.id,
        event.team,
      ))
        this.pending.push({
          ...cue,
          time: origin + cue.delay,
          attack: event.phase === "attack" ? event.id : undefined,
          owner: ["attack", "spawn", "summon", "appear", "hide"].includes(
            event.phase,
          )
            ? event.actor
            : undefined,
        });
    }
    this.pending.sort((a, b) => a.time - b.time);
  }
  update(time: number, paused = false, livingActors?: ReadonlySet<number>) {
    if (!this.audio.enabled) this.pending = [];
    if (paused) return;
    const remaining: typeof this.pending = [];
    for (const cue of this.pending) {
      // A coalesced snapshot can omit an older death event. Current entity
      // liveness still prevents a delayed voice from outliving its owner.
      if (
        cue.owner !== undefined &&
        livingActors &&
        !livingActors.has(cue.owner)
      )
        continue;
      if (cue.time > time) {
        remaining.push(cue);
        continue;
      }
      if (
        time - cue.time > 0.5 ||
        cue.time - (this.lastPlayed.get(cue.group) ?? -Infinity) < cue.repeat
      )
        continue;
      const playing = this.audio.play(cue.file, cue.volume, {
        pitch: cue.pitch,
        group: cue.group,
        maximum: cue.maximum,
      });
      if (playing && cue.repeat) this.lastPlayed.set(cue.group, cue.time);
    }
    this.pending = remaining;
  }
  reset() {
    this.cursor = 0;
    this.pending = [];
    this.lastPlayed.clear();
  }
  skip(events: readonly CombatAudioEvent[]) {
    this.reset();
    this.cursor = events.at(-1)?.id ?? 0;
  }
}
