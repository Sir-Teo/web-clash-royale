import { preloadNativeImages } from "./native-assets";
import type { Mode } from "../game/engine";
import settings from "./intro-settings.json";
import { renderRetainedNativeFrame, type NativeData } from "./native";

export const INTRO_ACTION_TIME = settings.actionFrame / settings.fps;
export const INTRO_DURATION = settings.frames / settings.fps;
export class IntroClock {
  time: number | null = null;
  get active() {
    return this.time !== null && this.time < INTRO_DURATION;
  }
  get blocking() {
    return this.time !== null && this.time < INTRO_ACTION_TIME;
  }
  start() {
    this.time = 0;
  }
  skip() {
    this.time = null;
  }
  advance(delta: number) {
    const dt = Math.max(0, delta);
    if (this.time === null) return dt;
    const before = this.time;
    this.time = Math.min(INTRO_DURATION, before + dt);
    if (Math.abs(this.time - INTRO_ACTION_TIME) < 1e-8)
      this.time = INTRO_ACTION_TIME;
    if (Math.abs(this.time - INTRO_DURATION) < 1e-8) this.time = INTRO_DURATION;
    return Math.max(0, before + dt - Math.max(before, INTRO_ACTION_TIME));
  }
}

export class NativeIntro {
  readonly clock = new IntroClock();
  private data: NativeData | null = null;
  private signature = "";
  private name = "pvp_battle_start";
  private overrides: Record<string, string> = {};
  constructor(private host: HTMLElement) {
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  get state() {
    return {
      active: this.clock.active,
      blocking: this.clock.blocking,
      time: this.clock.time,
      frame:
        this.clock.time === null
          ? null
          : Math.min(
              settings.frames - 1,
              Math.floor(this.clock.time * settings.fps + 1e-6),
            ),
      name: this.name,
    };
  }
  private async load() {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/intro/intro.json`,
      );
      if (!r.ok) throw new Error(`Native intro: ${r.status}`);
      const data: NativeData = await r.json();
      await Promise.all([
        document.fonts.load('40px "Supercell Magic"'),
        preloadNativeImages(data, `${import.meta.env.BASE_URL}assets/ui/intro`),
      ]);
      this.data = data;
      this.signature = "";
    } catch (error) {
      console.warn("Native intro assets unavailable", error);
    }
  }
  start(player: string, mode: Mode, enemy = "Royal Trainer") {
    this.name =
      mode === "training" ? "pvp_battle_start_training" : "pvp_battle_start";
    this.overrides = { "player/name": player, "enemy/name": enemy };
    this.signature = "";
    this.clock.start();
  }
  skip() {
    this.clock.skip();
    this.signature = "";
    this.host.replaceChildren();
    this.host.classList.add("hidden");
    this.host.setAttribute("aria-label", "Battle introduction");
    delete this.host.dataset.frame;
  }
  update(visible: boolean) {
    if (!visible || !this.clock.active || !this.data) {
      if (!this.host.classList.contains("hidden"))
        this.host.classList.add("hidden");
      this.signature = "";
      return;
    }
    const frame = this.state.frame!;
    const signature = `${this.name}:${frame}`;
    if (signature === this.signature) return;
    this.signature = signature;
    renderRetainedNativeFrame(
      this.host,
      this.data,
      this.name,
      frame,
      this.overrides,
      {
        path: `${import.meta.env.BASE_URL}assets/ui/intro`,
        viewBox: "-360 -320 720 640",
        prefix: "intro",
        fit: true,
        omit: ["league"],
      },
    );
    this.host.dataset.frame = String(frame);
    this.host.dataset.clip = this.name;
    if (this.host.classList.contains("hidden"))
      this.host.classList.remove("hidden");
  }
}
