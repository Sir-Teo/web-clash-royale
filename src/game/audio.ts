export interface SoundOptions {
  pitch?: number;
  group?: string;
  maximum?: number;
}

export function battleMusicCue(time: number) {
  const elapsed = Math.max(0, time);
  if (elapsed < 120)
    return { file: "battle", offset: elapsed };
  if (elapsed < 150)
    return { file: "battle-last-minute", offset: (elapsed - 120) % 29.996621 };
  if (elapsed < 180)
    return { file: "battle-final-30", offset: (elapsed - 150) % 20 };
  return { file: "battle-sudden-death", offset: (elapsed - 180) % 48 };
}

export class GameAudio {
  enabled = true;
  musicEnabled = false;
  private music: HTMLAudioElement | null = null;
  private musicFile = "";
  private musicOffset = 0;
  private musicStarting: HTMLAudioElement | null = null;
  private lastMusicAttempt = -Infinity;
  private sounds = new Map<string, HTMLAudioElement>();
  private last = new Map<string, number>();
  private active = new Map<HTMLAudioElement, SoundOptions>();
  private rate = 1;
  get musicState() {
    return {
      file: this.musicFile || null,
      position: this.music?.currentTime ?? 0,
      paused: this.music?.paused ?? true,
      rate: this.music?.playbackRate ?? this.rate,
    };
  }
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
  startMusic(time = 0) {
    this.lastMusicAttempt = -Infinity;
    this.syncMusic(time, true, true);
  }
  syncMusic(time: number, active: boolean, seek = false) {
    if (!active || !this.musicEnabled) {
      this.stopMusic();
      return;
    }
    const cue = battleMusicCue(time);
    this.musicOffset = cue.offset;
    if (!this.music || this.musicFile !== cue.file) {
      this.music?.pause();
      const track = new Audio(`${import.meta.env.BASE_URL}assets/audio/${cue.file}.ogg`);
      track.loop = true;
      track.volume = 0.12;
      track.playbackRate = this.rate;
      track.addEventListener("loadedmetadata", () => {
        if (this.music === track) this.seekMusic(track);
      }, { once: true });
      this.music = track;
      this.musicFile = cue.file;
      this.lastMusicAttempt = -Infinity;
      seek = true;
    }
    if (seek) this.seekMusic(this.music);
    if (this.music.paused && this.musicStarting !== this.music &&
        performance.now() - this.lastMusicAttempt > 500) {
      this.lastMusicAttempt = performance.now();
      const track = this.music;
      this.musicStarting = track;
      void track.play().catch(() => {}).finally(() => {
        if (this.musicStarting === track) this.musicStarting = null;
      });
    }
  }
  private seekMusic(track: HTMLAudioElement) {
    try { track.currentTime = this.musicOffset; } catch { /* Wait for metadata. */ }
  }
  stopMusic() {
    if (this.music && !this.music.paused) this.music.pause();
    this.musicStarting = null;
  }
  stopEffects() {
    for (const sound of this.active.keys()) sound.pause();
    this.active.clear();
  }
  setRate(rate: number) {
    this.rate = Math.max(0.25, Math.min(4, rate));
    if (this.music) this.music.playbackRate = this.rate;
    for (const [sound, options] of this.active)
      sound.playbackRate = this.rate * (options.pitch ?? 1);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopEffects();
    }
  }
}
