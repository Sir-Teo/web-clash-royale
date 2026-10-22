import {
  EMOTES,
  EMOTE_COOLDOWN,
  EMOTE_LABELS,
  type EmoteKind,
} from "../game/emotes";
import type { Team } from "../game/engine";
import { EmoteClock, emoteView, emoteCell, type EmoteData } from "./emote-data";
import { renderNativeFrame } from "./native";
import "./emotes.css";

const path = "/assets/ui/emotes";
const fallback: Record<EmoteKind, string> = {
  laugh: "Ha ha!",
  thumbs: "Well played!",
  cry: "Boo hoo!",
  angry: "Grrr!",
};
export class NativeEmotes {
  readonly clock = new EmoteClock();
  private data: EmoteData | null = null;
  private available = false;
  private nextSend = 0;
  private muted = false;
  private open = false;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private bubbles: Record<Team, HTMLElement>;
  private menu: HTMLElement;
  private muteButton: HTMLButtonElement;
  private signatures: Partial<Record<Team, string>> = {};
  private stops: Partial<Record<Team, () => void>> = {};
  private voices: Partial<Record<EmoteKind, number>> = {};
  onSend: (kind: EmoteKind) => boolean = () => false;
  onMute: (muted: boolean) => void = () => {};
  onCue: (name: string, volume: number) => void | (() => void) = () => {};
  constructor(
    private host: HTMLElement,
    private button: HTMLButtonElement,
    muted = false,
  ) {
    this.muted = muted;
    host.classList.add("native-emotes");
    host.innerHTML = `<div class="native-emote-bubble blue hidden" role="img"></div><div class="native-emote-bubble red hidden" role="img"></div><div id="emote-selector" class="emote-selector hidden" role="group" aria-label="King emotes"><div class="emote-options">${EMOTES.map((kind) => `<button type="button" data-emote="${kind}" aria-label="Send ${EMOTE_LABELS[kind]}"><span class="emote-option-art">${fallback[kind]}</span></button>`).join("")}</div><button class="emote-mute" type="button"><span class="emote-mute-art" aria-hidden="true"></span><span class="emote-mute-label"></span></button></div>`;
    this.bubbles = {
      blue: host.querySelector(".blue")!,
      red: host.querySelector(".red")!,
    };
    this.menu = host.querySelector(".emote-selector")!;
    this.muteButton = host.querySelector(".emote-mute")!;
    button.setAttribute("aria-label", "King emotes");
    button.setAttribute("aria-controls", "emote-selector");
    button.setAttribute("aria-expanded", "false");
    button.onclick = () => this.setOpen(!this.open);
    host.querySelectorAll<HTMLButtonElement>("[data-emote]").forEach((b) => {
      b.onclick = () => {
        if (!this.available || this.muted || performance.now() < this.nextSend)
          return;
        if (this.onSend(b.dataset.emote as EmoteKind)) {
          this.nextSend = performance.now() + EMOTE_COOLDOWN * 1000;
          this.setOpen(false);
          this.button.focus({ preventScroll: true });
        }
      };
    });
    this.muteButton.onclick = () => this.setMuted(!this.muted);
    document.addEventListener("pointerdown", (e) => {
      if (
        this.open &&
        !this.host.contains(e.target as Node) &&
        !this.button.contains(e.target as Node)
      )
        this.setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (this.open && e.key === "Escape") {
        this.setOpen(false);
        this.button.focus({ preventScroll: true });
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
    this.refreshMute();
    void this.load();
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  get state() {
    return {
      muted: this.muted,
      open: this.open,
      blue: this.clock.frame("blue", this.reduced.matches),
      red: this.clock.frame("red", this.reduced.matches),
    };
  }
  private async load() {
    try {
      const response = await fetch(`${path}/emotes.json`);
      if (!response.ok) throw new Error(`Native emotes: ${response.status}`);
      const data: EmoteData = await response.json();
      await Promise.all(
        Object.values(data.shapes)
          .flatMap((s) => s.polygons ?? [s])
          .filter((s) => s.file)
          .map(async (s) => {
            const image = new Image();
            image.src = `${path}/${s.file}`;
            await image.decode();
          }),
      );
      this.data = data;
      renderNativeFrame(
        this.button,
        data,
        "button",
        0,
        {},
        { path, viewBox: "-37 -34 74 72", prefix: "emote-toggle" },
      );
      this.button.classList.add("native-emote-toggle");
      this.button.setAttribute("aria-label", "King emotes");
      for (const kind of EMOTES) {
        const art = this.menu.querySelector<HTMLElement>(
          `[data-emote="${kind}"] .emote-option-art`,
        )!;
        renderNativeFrame(
          art,
          emoteCell(data, kind),
          "display",
          0,
          {},
          { path, viewBox: "-58 -73 116 95", prefix: `emote-option-${kind}` },
        );
        art.setAttribute("aria-hidden", "true");
      }
      this.refreshMute();
      this.signatures = {};
    } catch (error) {
      console.warn(
        "Native emotes unavailable; retaining text reactions",
        error,
      );
    }
  }
  private setOpen(open: boolean) {
    const next = open && this.available;
    if (this.open === next) return;
    this.open = next;
    this.menu.classList.toggle("hidden", !this.open);
    this.button.setAttribute("aria-expanded", String(this.open));
  }
  private refreshMute() {
    this.muteButton.setAttribute("aria-pressed", String(this.muted));
    this.muteButton.setAttribute(
      "aria-label",
      this.muted ? "Unmute emotes" : "Mute emotes",
    );
    this.muteButton.querySelector(".emote-mute-label")!.textContent = this.muted
      ? "Emotes muted"
      : "Mute emotes";
    this.button.classList.toggle("emotes-muted", this.muted);
    if (this.data)
      renderNativeFrame(
        this.menu.querySelector(".emote-mute-art")!,
        this.data,
        "mute",
        this.muted ? 1 : 0,
        {},
        { path, viewBox: "-37 -34 74 72", prefix: "emote-mute" },
      );
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.clear();
    this.refreshMute();
    this.onMute(muted);
  }
  show(team: Team, kind: EmoteKind) {
    if (this.muted || document.hidden) return false;
    this.stops[team]?.();
    this.clock.show(team, kind);
    delete this.signatures[team];
    const voice = this.data?.voices[kind];
    if (voice) {
      const index = this.voices[kind] ?? 0;
      this.voices[kind] = index + 1;
      const stop = this.onCue(
        voice.files[index % voice.files.length],
        voice.volume,
      );
      if (stop) this.stops[team] = stop;
    }
    this.render();
    return true;
  }
  clear() {
    this.clock.reset();
    for (const team of ["blue", "red"] as const) {
      this.stops[team]?.();
      delete this.stops[team];
      this.bubbles[team].classList.add("hidden");
      this.bubbles[team].replaceChildren();
      delete this.bubbles[team].dataset.kind;
      delete this.bubbles[team].dataset.frame;
      delete this.bubbles[team].dataset.expression;
    }
    this.signatures = {};
  }
  reset() {
    this.clear();
    this.setOpen(false);
    this.nextSend = 0;
  }
  suspend() {
    this.clear();
    this.setOpen(false);
  }
  update(delta: number, available: boolean) {
    this.available = available;
    if (this.button.disabled === available) this.button.disabled = !available;
    if (!available && this.open) this.setOpen(false);
    this.menu
      .querySelectorAll<HTMLButtonElement>("[data-emote]")
      .forEach((b) => {
        const disabled =
          !available || this.muted || performance.now() < this.nextSend;
        if (b.disabled !== disabled) b.disabled = disabled;
      });
    this.clock.advance(delta);
    this.render();
  }
  private render() {
    for (const team of ["blue", "red"] as const) {
      const frame = this.clock.frame(team, this.reduced.matches),
        host = this.bubbles[team];
      if (!frame) {
        if (!host.classList.contains("hidden")) host.classList.add("hidden");
        continue;
      }
      if (host.classList.contains("hidden")) host.classList.remove("hidden");
      const signature = `${frame.kind}:${frame.bubble}:${frame.expression}:${!!this.data}`;
      if (this.signatures[team] === signature) continue;
      this.signatures[team] = signature;
      host.classList.toggle("native-emote-ready", !!this.data);
      if (this.data)
        renderNativeFrame(
          host,
          emoteView(
            this.data,
            team,
            frame.kind,
            frame.bubble,
            frame.expression,
          ),
          "display",
          0,
          {},
          {
            path,
            viewBox: team === "blue" ? "-85 -155 290 220" : "-175 -100 260 175",
            prefix: `emote-${team}`,
          },
        );
      else host.textContent = fallback[frame.kind];
      host.setAttribute(
        "aria-label",
        `${team === "blue" ? "You" : "Opponent"}: ${EMOTE_LABELS[frame.kind]}`,
      );
      host.dataset.kind = frame.kind;
      host.dataset.frame = String(frame.bubble);
      host.dataset.expression = String(frame.expression);
    }
  }
}
