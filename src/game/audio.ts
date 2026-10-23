export interface SoundOptions {
  pitch?: number;
  group?: string;
  maximum?: number;
}

export class GameAudio {
  enabled = true;
  musicEnabled = false;
  private music: HTMLAudioElement | null = null;
  private sounds = new Map<string, HTMLAudioElement>();
  private last = new Map<string, number>();
  private active = new Map<HTMLAudioElement, SoundOptions>();
  private rate = 1;
  play(name: string, volume = 0.45, options: SoundOptions = {}) {
    if (!this.enabled) return;
    if (options.group) {
      const voices = [...this.active.values()].filter(
        (voice) => voice.group === options.group,
      ).length;
      if (options.maximum && voices >= options.maximum) return;
    } else {
      const now = performance.now();
      if (now - (this.last.get(name) ?? -1000) < 80) return;
      this.last.set(name, now);
    }
    try {
      let base = this.sounds.get(name);
      if (!base) {
        base = new Audio(`${import.meta.env.BASE_URL}assets/audio/${name}.ogg`);
        this.sounds.set(name, base);
      }
      const a = base.cloneNode() as HTMLAudioElement;
      a.volume = Math.max(0, Math.min(1, volume));
      a.playbackRate = this.rate * (options.pitch ?? 1);
      // Native pitch variation requires resampling instead of time stretching.
      if (options.pitch !== undefined) a.preservesPitch = false;
      this.active.set(a, options);
      const release = () => this.active.delete(a);
      a.addEventListener("ended", release, { once: true });
      a.addEventListener("error", release, { once: true });
      void a.play().catch(release);
      return () => {
        a.pause();
        this.active.delete(a);
      };
    } catch {
      /* Audio is optional. */
    }
  }
  startMusic() {
    if (!this.musicEnabled || !this.enabled) return;
    if (!this.music) {
      this.music = new Audio(
        `${import.meta.env.BASE_URL}assets/audio/battle.ogg`,
      );
      this.music.loop = true;
      this.music.volume = 0.12;
    }
    void this.music.play().catch(() => {});
  }
  stopMusic() {
    this.music?.pause();
  }
  stopEffects() {
    for (const sound of this.active.keys()) sound.pause();
    this.active.clear();
  }
  setRate(rate: number) {
    this.rate = Math.max(0.25, Math.min(4, rate));
    for (const [sound, options] of this.active)
      sound.playbackRate = this.rate * (options.pitch ?? 1);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
      this.stopEffects();
    }
  }
}
