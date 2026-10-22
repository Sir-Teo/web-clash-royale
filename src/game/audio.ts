export class GameAudio {
  enabled = true;
  musicEnabled = false;
  private music: HTMLAudioElement | null = null;
  private sounds = new Map<string, HTMLAudioElement>();
  private last = new Map<string, number>();
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
      void a.play().catch(() => {});
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
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopMusic();
  }
}
