import type { Entity, Point } from "../game/engine";
import { renderNativeFrame, type NativeData } from "../ui/native";
import source from "./charge-marker-data.json";

const data = source as NativeData;
const clip = data.clips.effect_charge;
const life = clip.frames.length / clip.fps;
interface Marker {
  host: HTMLDivElement;
  start: number;
  frame: number;
}

/** The source SWF animates a dynamic `txt` child; its 43 matrices are retained. */
export class NativeChargeMarkers {
  private layer: HTMLDivElement;
  private markers = new Map<number, Marker>();
  constructor(
    host: HTMLElement,
    private project: (x: number, y: number, height: number) => Point,
  ) {
    this.layer = document.createElement("div");
    this.layer.className = "charge-markers";
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "6",
      pointerEvents: "none",
      overflow: "hidden",
    });
    host.append(this.layer);
    void document.fonts.load('18px "Supercell Magic"');
  }
  get count() {
    return this.markers.size;
  }
  burst(actor: number, time: number, age: number) {
    if (age >= life) return;
    this.markers.get(actor)?.host.remove();
    const host = document.createElement("div");
    host.className = "charge-marker";
    host.dataset.source = "effect_charge";
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "absolute",
      left: "0",
      top: "0",
      transform: "translate(-50%,-50%)",
      fontFamily: '"Supercell Magic", sans-serif',
      fontSynthesis: "none",
    });
    this.layer.append(host);
    this.markers.set(actor, { host, start: time - age, frame: -1 });
  }
  update(entities: readonly Entity[], time: number, width: number) {
    const actors = new Map(entities.map((entity) => [entity.id, entity]));
    for (const [id, marker] of this.markers) {
      const actor = actors.get(id),
        age = time - marker.start;
      if (!actor || actor.hp <= 0 || age >= life) {
        marker.host.remove();
        this.markers.delete(id);
        continue;
      }
      const frame = Math.max(
        0,
        Math.min(clip.frames.length - 1, Math.floor(age * clip.fps)),
      );
      if (frame !== marker.frame) {
        renderNativeFrame(
          marker.host,
          data,
          "effect_charge",
          frame,
          {},
          {
            path: `${import.meta.env.BASE_URL}assets/ui`,
            viewBox: "-180 -60 360 120",
            prefix: `charge-${id}`,
            font: "Supercell Magic",
          },
        );
        marker.host.dataset.frame = String(frame);
        const svg = marker.host.querySelector("svg")!;
        Object.assign(svg.style, {
          display: "block",
          width: "100%",
          height: "100%",
          overflow: "visible",
        });
        marker.frame = frame;
      }
      const size = Math.min(width * 0.67, 440);
      marker.host.style.width = `${size}px`;
      marker.host.style.height = `${size / 3}px`;
      const point = this.project(actor.x, actor.y, 3.05);
      marker.host.style.left = `${point.x}px`;
      marker.host.style.top = `${point.y}px`;
    }
  }
  clear() {
    for (const marker of this.markers.values()) marker.host.remove();
    this.markers.clear();
  }
  destroy() {
    this.clear();
    this.layer.remove();
  }
}
