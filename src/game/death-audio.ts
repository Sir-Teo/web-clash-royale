import definitions from "./death-audio-data.json";
import { towerSites } from "./arena-layout";
import type { BattleEvent, Team } from "./engine";
import type { GameAudio } from "./audio";

type Effect = keyof typeof definitions.effects;
type Sound = keyof typeof definitions.sounds;
export interface DeathCue {
  group: string;
  file: string;
  delay: number;
  volume: number;
  pitch: number;
  maximum: number;
}
// Same browser mix gain as native announcements; randomness never touches Battle.
const MIX_GAIN = 0.35;
const MAX_LATENESS = 0.5;
export function deathAudioPlan(
  effect: string,
  seed: number,
  team: Team = "blue",
): DeathCue[] {
  if (!Object.hasOwn(definitions.effects, effect)) return [];
  let state = seed | 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  const between = (range: number[]) =>
    range[0] + random() * (range[1] - range[0]);
  const components =
    definitions.effects[effect as Effect][
      team === "red" ? "enemyComponents" : "components"
    ];
  return components.flatMap((component) => {
    const source = definitions.sounds[component.sound as Sound];
    if (!source.files.length) return [];
    return [
      {
        group: component.sound,
        file: source.files[Math.floor(random() * source.files.length)],
        delay: component.delay + between(source.startDelay),
        volume: between(source.volume) * MIX_GAIN,
        pitch: between(source.pitch),
        maximum: source.maximum,
      },
    ];
  });
}

/** Delays use match time so pause and replay speed cannot leak wall-clock cues. */
export class NativeDeathAudio {
  private pending: (DeathCue & { time: number })[] = [];
  constructor(private readonly audio: Pick<GameAudio, "enabled" | "play">) {}
  queue(event: BattleEvent, seed: number, now: number, nativeTowerLayout?: true) {
    if (
      event.type !== "death" ||
      !this.audio.enabled ||
      now - event.time > MAX_LATENESS
    )
      return;
    const king =
      event.card === "tower" &&
      towerSites(nativeTowerLayout).some(
        (site) =>
          site.king &&
          site.team === event.team &&
          site.x === event.x &&
          site.y === event.y,
      );
    const effect = king ? "king" : (event.card ?? "");
    for (const cue of deathAudioPlan(effect, seed ^ event.id, event.team)) {
      this.pending.push({ ...cue, time: event.time + cue.delay });
    }
  }
  update(time: number, paused = false) {
    if (!this.audio.enabled) this.reset();
    if (paused) return;
    const remaining: typeof this.pending = [];
    for (const cue of this.pending) {
      if (cue.time > time) remaining.push(cue);
      else if (time - cue.time <= MAX_LATENESS)
        this.audio.play(cue.file, cue.volume, {
          pitch: cue.pitch,
          group: cue.group,
          maximum: cue.maximum,
        });
    }
    this.pending = remaining;
  }
  reset() {
    this.pending = [];
  }
}
