export class GameAudio {
  enabled = true;
  musicEnabled = false;
  private music: HTMLAudioElement | null = null;
  private sounds = new Map<string, HTMLAudioElement>();
  private last = new Map<string, number>();
  private active = new Set<HTMLAudioElement>();
  private rate = 1;
  play(name: string, volume = 0.45) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1000) < 80) return;
    this.last.set(name, now);
    try {
      let base = this.sounds.get(name);
      if (!base) {
        base = new Audio(`/assets/audio/${name}.ogg`);
        this.sounds.set(name, base);
      }
      const a = base.cloneNode() as HTMLAudioElement;
      a.volume = volume;
      a.playbackRate = this.rate;
      this.active.add(a);
      a.addEventListener("ended", () => this.active.delete(a), { once: true });
      void a.play().catch(() => this.active.delete(a));
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
      this.music = new Audio("/assets/audio/battle.ogg");
      this.music.loop = true;
      this.music.volume = 0.12;
    }
    void this.music.play().catch(() => {});
  }
  stopMusic() {
    this.music?.pause();
  }
  stopEffects() {
    for (const sound of this.active) sound.pause();
    this.active.clear();
  }
  setRate(rate: number) {
    this.rate = Math.max(0.25, Math.min(4, rate));
    for (const sound of this.active) sound.playbackRate = this.rate;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
      this.stopEffects();
    }
  }
}
