import { renderNativeFrame, type NativeData } from "./native";
export { textureMatrix } from "./native";
import type { Mode } from "../game/engine";

export interface BattleTiming {
  time: number;
  winner: string | null;
  mode: Mode;
}
export type AnnouncementName =
  | "print_endTimer"
  | "print_30secondsLeft"
  | "print_60secondsLeft"
  | "print_60secondsLeft_overtime"
  | "print_extra_time";
export interface Announcement {
  name: AnnouncementName;
  frame: number;
  overrides: Record<string, string>;
}
export function battleClock(b: BattleTiming) {
  const overtime = b.time >= 180 && !(b.winner && b.time === 180);
  return { overtime, remaining: Math.max(0, (overtime ? 300 : 180) - b.time) };
}
export function announcementAt(b: BattleTiming): Announcement | null {
  if (b.winner) return null;
  const remaining = battleClock(b).remaining;
  if (remaining > 0 && remaining <= 12) {
    const frame =
      remaining > 10
        ? Math.min(58, Math.floor((12 - remaining) * 30 + 1e-6))
        : Math.min(356, 59 + Math.floor((10 - remaining) * 30 + 1e-6));
    return { name: "print_endTimer", frame, overrides: {} };
  }
  const phase =
    b.time >= 270
      ? 270
      : b.time >= 240
        ? 240
        : b.time >= 180
          ? 180
          : b.time >= 150
            ? 150
            : b.time >= 120
              ? 120
              : 0;
  if (!phase) return null;
  const frame = Math.floor((b.time - phase) * 30 + 1e-6);
  if (phase === 180)
    return frame < 139
      ? { name: "print_extra_time", frame, overrides: { TID_60S: "+120s" } }
      : null;
  if (phase === 150 || phase === 270)
    return frame < 80
      ? { name: "print_30secondsLeft", frame, overrides: {} }
      : null;
  const alreadyDouble = phase === 120 && b.mode === "double";
  return frame < (alreadyDouble ? 71 : 148)
    ? {
        name: alreadyDouble
          ? "print_60secondsLeft_overtime"
          : "print_60secondsLeft",
        frame,
        overrides: phase === 240 ? { TID_X2_ELIXIR: "X3 Elixir" } : {},
      }
    : null;
}
export function timingCue(before: number | null, b: BattleTiming) {
  if (before === null || b.winner || b.time <= before || b.time - before > 0.5)
    return null;
  if (before < 180 && b.time >= 180) return "sound_extra_time_jingle";
  const remaining = battleClock(b).remaining;
  const number = Math.ceil(remaining - 1e-8);
  const previous = Math.ceil((b.time < 180 ? 180 : 300) - before - 1e-8);
  return number >= 1 && number <= 10 && number !== previous
    ? `Countdown_${number}`
    : null;
}

export class NativeAnnouncements {
  private data: NativeData | null = null;
  private previous: number | null = null;
  private signature = "";
  private current: Announcement | null = null;
  onCue: (file: string, volume: number) => void = () => {};
  constructor(private host: HTMLElement) {
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  get state() {
    return this.current ? { ...this.current } : null;
  }
  cue(name: string) {
    const sound = this.data?.audio[name];
    if (sound) this.onCue(sound.file, sound.volume * 0.35);
  }
  private async load() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/announcements.json`,
      );
      if (!response.ok) throw new Error(`Native UI: ${response.status}`);
      const data: NativeData = await response.json();
      await document.fonts.load('40px "Supercell Magic"');
      await Promise.all(
        Object.values(data.shapes).map(async (shape) => {
          const image = new Image();
          image.src = `${import.meta.env.BASE_URL}assets/ui/${shape.file}`;
          await image.decode();
        }),
      );
      this.data = data;
      this.signature = "";
    } catch (error) {
      console.warn("Native announcement assets unavailable", error);
    }
  }
  reset() {
    this.previous = null;
    this.current = null;
    this.signature = "";
    this.host.replaceChildren();
    this.host.setAttribute("aria-label", "Battle announcement");
    delete this.host.dataset.clip;
    delete this.host.dataset.frame;
    this.host.classList.add("hidden");
  }
  update(b: BattleTiming, visible: boolean) {
    const cue = visible ? timingCue(this.previous, b) : null;
    this.previous = b.time;
    if (cue) this.cue(cue);
    this.current = visible ? announcementAt(b) : null;
    if (!this.current || !this.data) {
      if (!this.host.classList.contains("hidden"))
        this.host.classList.add("hidden");
      this.signature = "";
      return;
    }
    const selected = this.current;
    const signature = JSON.stringify(selected);
    if (signature === this.signature) return;
    this.signature = signature;
    renderNativeFrame(
      this.host,
      this.data,
      selected.name,
      selected.frame,
      selected.overrides,
      {
        path: `${import.meta.env.BASE_URL}assets/ui`,
        viewBox: "-360 -140 720 280",
        prefix: "announcement",
      },
    );
    this.host.dataset.clip = selected.name;
    this.host.dataset.frame = String(selected.frame);
    if (this.host.classList.contains("hidden"))
      this.host.classList.remove("hidden");
  }
}
