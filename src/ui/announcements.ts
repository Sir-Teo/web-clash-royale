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

type Matrix = number[];
interface TextStyle {
  size: number;
  color: number;
  outlineColor: number;
  outlined: boolean;
  align: number;
  bounds: number[];
}
interface Part {
  text?: number;
  binding?: string;
  shape?: number;
  matrix: Matrix;
  color: number[];
}
interface Shape {
  file: string;
  width: number;
  height: number;
  xy: number[][];
  uv: number[][];
}
interface NativeData {
  clips: Record<AnnouncementName, { fps: number; frames: Part[][] }>;
  texts: Record<number, TextStyle>;
  translations: Record<string, string>;
  shapes: Record<number, Shape>;
  audio: Record<string, { file: string; volume: number }>;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const matrix = (m: Matrix) => `matrix(${m.join(" ")})`;
function color(value: number, transform: number[]) {
  const rgb = [(value >>> 16) & 255, (value >>> 8) & 255, value & 255].map(
    (c, i) =>
      Math.min(255, Math.round((c * transform[4 + i]) / 255 + transform[i])),
  );
  return `rgba(${rgb.join(",")},${(value >>> 24) / 255})`;
}
export function textureMatrix(shape: Pick<Shape, "uv" | "xy">): Matrix {
  // Source positions are quantized independently of UVs. Fit the complete
  // polygon so rounding at three vertices does not skew the remaining image.
  const mean = (points: number[][]) =>
    points.reduce(
      (sum, p) => [
        sum[0] + p[0] / points.length,
        sum[1] + p[1] / points.length,
      ],
      [0, 0],
    );
  const [u, v] = mean(shape.uv),
    [x, y] = mean(shape.xy);
  let uu = 0,
    uv = 0,
    vv = 0,
    ux = 0,
    vx = 0,
    uy = 0,
    vy = 0;
  shape.uv.forEach(([a, b], i) => {
    a -= u;
    b -= v;
    const c = shape.xy[i][0] - x,
      d = shape.xy[i][1] - y;
    uu += a * a;
    uv += a * b;
    vv += b * b;
    ux += a * c;
    vx += b * c;
    uy += a * d;
    vy += b * d;
  });
  const det = uu * vv - uv * uv;
  const a = (ux * vv - vx * uv) / det,
    c = (vx * uu - ux * uv) / det;
  const b = (uy * vv - vy * uv) / det,
    d = (vy * uu - uy * uv) / det;
  return [a, b, c, d, x - a * u - c * v, y - b * u - d * v];
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
      const response = await fetch("/assets/ui/announcements.json");
      if (!response.ok) throw new Error(`Native UI: ${response.status}`);
      const data: NativeData = await response.json();
      await document.fonts.load('40px "Supercell Magic"');
      await Promise.all(
        Object.values(data.shapes).map(async (shape) => {
          const image = new Image();
          image.src = `/assets/ui/${shape.file}`;
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
      this.host.classList.add("hidden");
      this.signature = "";
      return;
    }
    const selected = this.current;
    const signature = JSON.stringify(selected);
    if (signature === this.signature) return;
    this.signature = signature;
    const parts = this.data.clips[selected.name].frames[selected.frame];
    const labels: string[] = [];
    const content = parts
      .map((part, index) => {
        if (part.text !== undefined) {
          const style = this.data!.texts[part.text];
          const text =
            selected.overrides[part.binding!] ??
            this.data!.translations[part.binding!];
          labels.push(text);
          const [left, top, right] = style.bounds;
          const align = style.align & 3;
          const x =
            align === 1 ? right : align === 2 ? (left + right) / 2 : left;
          return `<g transform="${matrix(part.matrix)}" opacity="${part.color[3] / 255}"><text x="${x}" y="${top}" text-anchor="${align === 1 ? "end" : align === 2 ? "middle" : "start"}" dominant-baseline="text-before-edge" font-size="${style.size}" fill="${color(style.color, part.color)}" stroke="${style.outlined ? color(style.outlineColor, part.color) : "none"}" stroke-width="${Math.max(2, style.size / 18)}" stroke-linejoin="round" paint-order="stroke fill">${escape(text)}</text></g>`;
        }
        const shape = this.data!.shapes[part.shape!];
        const clip = `announcement-shape-${index}`,
          filter = `announcement-tint-${index}`;
        return `<g transform="${matrix(part.matrix)}"><defs><clipPath id="${clip}"><polygon points="${shape.xy.map((p) => p.join(",")).join(" ")}"/></clipPath><filter id="${filter}" color-interpolation-filters="sRGB"><feComponentTransfer>${["R", "G", "B"].map((channel, i) => `<feFunc${channel} type="linear" slope="${part.color[4 + i] / 255}" intercept="${part.color[i] / 255}"/>`).join("")}<feFuncA type="linear" slope="${part.color[3] / 255}"/></feComponentTransfer></filter></defs><g clip-path="url(#${clip})" filter="url(#${filter})"><image href="/assets/ui/${shape.file}" width="${shape.width}" height="${shape.height}" transform="${matrix(textureMatrix(shape))}"/></g></g>`;
      })
      .join("");
    this.host.innerHTML = `<svg viewBox="-360 -140 720 280" aria-hidden="true">${content}</svg>`;
    this.host.setAttribute("aria-label", labels.join(" "));
    this.host.dataset.clip = selected.name;
    this.host.dataset.frame = String(selected.frame);
    this.host.classList.remove("hidden");
  }
}
