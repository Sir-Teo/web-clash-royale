import { renderNativeFrame, type NativeData } from "./native";
import "./connection.css";

/** Original bad_connection clip; connection state remains owned by the client. */
export class NativeConnectionWarning {
  private data: NativeData | null = null;
  private requested = false;
  private start: number | null = null;
  private frame = -1;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(private host: HTMLElement) {
    host.classList.add("native-connection-warning", "hidden");
    host.setAttribute("aria-hidden", "true");
    void this.load();
  }
  get loaded() {
    return this.data ? 1 : 0;
  }
  get state() {
    return {
      active: !this.host.classList.contains("hidden"),
      frame: this.frame,
      reduced: this.motion.matches,
    };
  }
  private async load() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/connection/connection.json`,
      );
      if (!response.ok)
        throw new Error(`Connection warning: ${response.status}`);
      const data: NativeData = await response.json();
      await Promise.all(
        Object.values(data.shapes)
          .flatMap((s) => s.polygons ?? [s])
          .filter((p) => p.file)
          .map(async (p) => {
            const image = new Image();
            image.src = `${import.meta.env.BASE_URL}assets/ui/connection/${p.file}`;
            await image.decode();
          }),
      );
      this.data = data;
      this.update();
    } catch (error) {
      console.warn(
        "Native connection artwork unavailable; retaining text status",
        error,
      );
    }
  }
  setActive(active: boolean) {
    if (this.requested === active) return;
    this.requested = active;
    this.start = null;
    this.frame = -1;
    this.update();
  }
  suspend() {
    this.start = null;
    this.frame = -1;
    this.host.classList.add("hidden");
    delete this.host.dataset.frame;
  }
  reset() {
    this.requested = false;
    this.suspend();
  }
  update(now = performance.now() / 1000) {
    if (!this.requested || !this.data || document.hidden) {
      if (!this.host.classList.contains("hidden"))
        this.host.classList.add("hidden");
      return;
    }
    this.start ??= now;
    const clip = this.data.clips.bad_connection;
    // Frame zero is the source's highest-opacity pose.
    const frame = this.motion.matches
      ? 0
      : Math.floor(Math.max(0, now - this.start) * clip.fps) %
        clip.frames.length;
    if (this.host.classList.contains("hidden"))
      this.host.classList.remove("hidden");
    if (frame === this.frame) return;
    renderNativeFrame(
      this.host,
      this.data,
      "bad_connection",
      frame,
      {},
      {
        path: `${import.meta.env.BASE_URL}assets/ui/connection`,
        viewBox: "-80 -80 160 160",
        prefix: "connection-warning",
      },
    );
    this.frame = frame;
    this.host.dataset.frame = String(frame);
  }
}
