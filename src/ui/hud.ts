import { preloadNativeImages } from "./native-assets";
import { renderRetainedNativeFrame } from "./native";
import type { BattleTiming } from "./announcements";
import {
  CrownFeedback,
  hudClock,
  hudView,
  hudBox,
  hudTimeText,
  type CrownCounts,
  type HudData,
} from "./hud-data";
import "./hud.css";
let hudSerial = 0;
export class NativeBattleHud {
  readonly crowns = new CrownFeedback();
  private data: HudData | null = null;
  private timerArt: HTMLElement;
  private scoreArt: HTMLElement;
  private signatures = new WeakMap<HTMLElement, string>();
  private landscape = matchMedia(
    "(orientation: landscape) and (max-height: 540px)",
  );
  private motion = matchMedia("(prefers-reduced-motion: reduce)");
  private prefix = `hud-${hudSerial++}`;
  constructor(
    private timer: HTMLElement,
    private score: HTMLElement,
  ) {
    this.timerArt = document.createElement("div");
    this.timerArt.className = "native-timer-art";
    this.timerArt.setAttribute("aria-hidden", "true");
    timer.append(this.timerArt);
    this.scoreArt = document.createElement("div");
    this.scoreArt.className = "native-score-art";
    this.scoreArt.setAttribute("aria-hidden", "true");
    score.append(this.scoreArt);
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  get state() {
    return {
      landscape: this.landscape.matches,
      blueFrame: this.crowns.frame("blue", this.motion.matches),
      redFrame: this.crowns.frame("red", this.motion.matches),
    };
  }
  private async load() {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/hud/hud.json`,
      );
      if (!r.ok) throw new Error(`Native HUD: ${r.status}`);
      const data: HudData = await r.json();
      await Promise.all([
        document.fonts.load('28px "Supercell Magic"'),
        preloadNativeImages(data, `${import.meta.env.BASE_URL}assets/ui/hud`),
      ]);
      this.data = data;
    } catch (error) {
      console.warn(
        "Native timer and crowns unavailable; retaining fallback HUD",
        error,
      );
    }
  }
  reset(time: number, counts: CrownCounts) {
    this.crowns.reset(time, counts);
    this.signatures = new WeakMap();
  }
  target(team: keyof CrownCounts): DOMRect | null {
    return (
      this.scoreArt
        .querySelector(
          `[data-binding="${team === "blue" ? "starPlayer" : "starEnemy"}"]`,
        )
        ?.getBoundingClientRect() ?? null
    );
  }
  update(b: BattleTiming, counts: CrownCounts, presentationTime = b.time) {
    this.crowns.update(presentationTime, counts);
    if (!this.data) return;
    const clock = hudClock(b, this.motion.matches),
      text = hudTimeText(clock.seconds);
    const timerSignature = `${clock.name}:${clock.frame}:${text}`;
    if (this.signatures.get(this.timerArt) !== timerSignature) {
      renderRetainedNativeFrame(
        this.timerArt,
        this.data,
        clock.name,
        clock.frame,
        { "timeLeft/txt": text },
        {
          path: `${import.meta.env.BASE_URL}assets/ui/hud`,
          viewBox: "-104 -5 112 70",
          prefix: `${this.prefix}-timer`,
        },
      );
      this.timerArt.dataset.clip = clock.name;
      this.timerArt.dataset.frame = String(clock.frame);
      if (!this.timer.classList.contains("native-timer-ready")) {
        this.timer.classList.add("native-timer-ready");
        for (const node of this.timer.querySelectorAll(
          "#phase-label,#match-clock",
        ))
          node.setAttribute("aria-hidden", "true");
      }
      this.timer.setAttribute("role", "timer");
      this.timer.setAttribute(
        "aria-label",
        `${clock.overtime ? "Overtime" : "Time left"}: ${hudTimeText(Math.ceil(Math.max(0, (clock.overtime ? 300 : 180) - b.time)))}`,
      );
      this.signatures.set(this.timerArt, timerSignature);
    }
    const state = this.state;
    const scoreSignature = `${state.landscape}:${state.blueFrame}:${state.redFrame}:${counts.blue}:${counts.red}`;
    if (this.signatures.get(this.scoreArt) !== scoreSignature) {
      renderRetainedNativeFrame(
        this.scoreArt,
        hudView(this.data, state.landscape, state.blueFrame, state.redFrame),
        "display",
        0,
        {
          "scorePlayer/txt": String(counts.blue),
          "scoreEnemy/txt": String(counts.red),
        },
        {
          path: `${import.meta.env.BASE_URL}assets/ui/hud`,
          viewBox: hudBox(state.landscape),
          prefix: `${this.prefix}-score`,
          bind: true,
        },
      );
      this.scoreArt.dataset.blueFrame = String(state.blueFrame);
      this.scoreArt.dataset.redFrame = String(state.redFrame);
      this.score.classList.add("native-score-ready");
      this.score.classList.toggle("landscape-score", state.landscape);
      this.score.setAttribute("role", "img");
      this.score.setAttribute(
        "aria-label",
        `Crowns: Blue ${counts.blue}, Red ${counts.red}`,
      );
      this.signatures.set(this.scoreArt, scoreSignature);
    }
  }
}
