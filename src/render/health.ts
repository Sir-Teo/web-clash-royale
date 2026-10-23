import * as T from "three";
import type { Entity } from "../game/engine";
import {
  healthParts,
  healthBox,
  healthSelection,
  healthView,
  type HealthData,
} from "../ui/health-data";
import { renderNativeFrame } from "../ui/native";
import {
  makeMaterial,
  spriteGeometry,
  type SpriteAsset,
  type SpriteData,
} from "./sprites";
import "../ui/health.css";
export interface HealthSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  frame: number;
}
const rgba = (c: number) =>
  `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${(c >>> 24) / 255})`;
export class HealthLibrary {
  data: HealthData | null = null;
  private asset: SpriteAsset | null = null;
  private signatures = new WeakMap<HTMLElement, string>();
  private serial = 0;
  private disposed = false;
  async load() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}assets/ui/health/health.json`,
      );
      if (!response.ok) throw new Error(`Health artwork: ${response.status}`);
      const data: HealthData = await response.json();
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Health atlas unavailable"));
        i.src = `${import.meta.env.BASE_URL}assets/ui/health/${data.atlas.file}`;
      });
      await Promise.all([
        document.fonts.load('14px "Supercell Magic"'),
        ...Object.values(data.shapes).flatMap((s) =>
          (s.polygons ?? [s]).map(
            (p) =>
              new Promise<void>((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve();
                i.onerror = () =>
                  reject(new Error(`Health crop unavailable: ${p.file}`));
                i.src = `${import.meta.env.BASE_URL}assets/ui/health/${p.file}`;
              }),
          ),
        ),
      ]);
      if (this.disposed) return;
      // Rasterize only the two shared level labels. All bar polygons and fill
      // states stay as native geometry in one atlas/material per unit.
      const canvas = document.createElement("canvas"),
        resolution = 4;
      canvas.width = data.atlas.width * resolution;
      canvas.height = data.atlas.height * resolution;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(resolution, resolution);
      ctx.drawImage(image, 0, 0);
      const shapes: SpriteData["shapes"] = {};
      for (const [id, s] of Object.entries(data.shapes))
        shapes[Number(id)] = (s.polygons ?? [s]).map((p) => {
          const [x, y] = data.atlas.regions[p.file];
          return {
            sheet: 0,
            xy: p.xy as [number, number][],
            uv: p.uv.map(([u, v]) => [
              (x + u) / data.atlas.width,
              (y + v) / data.atlas.height,
            ]),
          };
        });
      const unitNames = Object.keys(data.clips).filter((n) =>
        /^hp_(player|enemy)_(small|medium|high|number)$/.test(n),
      );
      const textIds = [
        ...new Set(
          unitNames.flatMap((n) =>
            data.clips[n].frames[0].flatMap((p) =>
              p.text !== undefined ? [p.text] : [],
            ),
          ),
        ),
      ];
      textIds.forEach((id, index) => {
        const s = data.texts[id],
          pad = 3,
          [l, t, r, b] = s.bounds,
          left = l - pad,
          top = t - pad,
          width = r - l + pad * 2,
          height = b - t + pad * 2;
        const x = index * 64,
          y = data.atlas.textY;
        ctx.save();
        ctx.translate(x - left, y - top);
        ctx.font = `${s.size}px "Supercell Magic"`;
        ctx.textBaseline = "top";
        const align = s.align & 3;
        ctx.textAlign = align === 2 ? "center" : align === 1 ? "right" : "left";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, s.size / 18);
        ctx.strokeStyle = rgba(s.outlineColor);
        ctx.fillStyle = rgba(s.color);
        const textX = align === 2 ? (l + r) / 2 : align === 1 ? r : l;
        if (s.outlined) ctx.strokeText("11", textX, t);
        ctx.fillText("11", textX, t);
        ctx.restore();
        shapes[20000 + id] = [
          {
            sheet: 0,
            xy: [
              [left, top],
              [left + width, top],
              [left + width, top + height],
              [left, top + height],
            ],
            uv: [
              [x / data.atlas.width, y / data.atlas.height],
              [(x + width) / data.atlas.width, y / data.atlas.height],
              [
                (x + width) / data.atlas.width,
                (y + height) / data.atlas.height,
              ],
              [x / data.atlas.width, (y + height) / data.atlas.height],
            ],
          },
        ];
      });
      const frames: SpriteData["frames"] = [],
        clips: SpriteData["clips"] = {};
      for (const name of unitNames) {
        const indexes: number[] = [];
        for (let i = 0; i < (data.bars[name] ? 100 : 1); i++) {
          indexes.push(frames.length);
          frames.push(
            healthParts(data, name, 1 - i / 99).map((p) => ({
              shape: p.text !== undefined ? 20000 + p.text : p.shape!,
              matrix: p.matrix,
              color: p.color,
            })),
          );
        }
        clips[name] = { fps: 30, frames: indexes, source: name };
      }
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = T.LinearFilter;
      const material = makeMaterial(texture);
      material.depthTest = false;
      this.asset = {
        data: {
          version: 2,
          textures: [
            {
              file: data.atlas.file,
              width: data.atlas.width,
              height: data.atlas.height,
            },
          ],
          bounds: [-50, -30, 50, 30],
          anchor: [0, 0],
          shapes,
          clips,
          frames,
        },
        textures: [texture],
        materials: [material],
        geometry: new Map(),
        scale: 1,
      };
      this.data = data;
    } catch (error) {
      console.warn("Native health unavailable; retaining fallback bars", error);
    }
  }
  get loaded() {
    return this.data ? Object.keys(this.data.clips).length : 0;
  }
  make(e: Entity): HealthSprite | null {
    if (!this.asset || !this.data) return null;
    const selection = healthSelection(this.data, e),
      clip = this.asset.data.clips[selection.name];
    const frame = clip.frames[Math.min(selection.fill, clip.frames.length - 1)];
    const mesh = new T.Mesh(
      spriteGeometry(this.asset, frame),
      this.asset.materials,
    );
    mesh.renderOrder = 4;
    return { mesh, frame };
  }
  update(
    sprite: HealthSprite,
    e: Entity,
    camera: T.Camera,
    position: T.Vector3,
    pixelsToWorld: number,
  ) {
    const state = healthSelection(this.data!, e),
      clip = this.asset!.data.clips[state.name];
    sprite.mesh.visible = state.visible;
    if (!state.visible) return;
    const frame = clip.frames[Math.min(state.fill, clip.frames.length - 1)];
    if (frame !== sprite.frame) {
      sprite.mesh.geometry = spriteGeometry(this.asset!, frame);
      sprite.frame = frame;
    }
    sprite.mesh.position.copy(position);
    sprite.mesh.quaternion.copy(camera.quaternion);
    sprite.mesh.scale.setScalar(pixelsToWorld * 0.7);
    sprite.mesh.userData.health = {
      ...state,
      hp: Math.ceil(e.hp),
      maxHp: e.maxHp,
    };
  }
  tower(host: HTMLElement, e: Entity) {
    if (!this.data) return false;
    const state = healthSelection(this.data, e),
      signature = `${state.name}:${state.frame}:${state.fill}:${Math.ceil(e.hp)}`;
    if (this.signatures.get(host) === signature) return true;
    let art = host.querySelector<HTMLElement>(".native-health-art");
    if (!art) {
      art = document.createElement("div");
      art.className = "native-health-art";
      art.setAttribute("aria-hidden", "true");
      host.append(art);
    }
    renderNativeFrame(
      art,
      healthView(this.data, state.name, e.hp / e.maxHp, state.frame),
      "display",
      0,
      { level: "11", "hpNumber/txt": String(Math.ceil(e.hp)) },
      {
        path: `${import.meta.env.BASE_URL}assets/ui/health`,
        viewBox: healthBox(state.name),
        prefix: `health-tower-${++this.serial}`,
      },
    );
    host.classList.add("native-health-ready");
    host.classList.toggle("king-health", !!e.king);
    host.dataset.healthFrame = String(state.frame);
    host.dataset.healthFill = String(state.fill);
    host.dataset.healthKind = e.king ? "king" : "princess";
    host.setAttribute("role", "meter");
    host.setAttribute(
      "aria-label",
      `${e.team === "blue" ? "Blue" : "Red"} ${e.king ? "King" : "Princess"} Tower hitpoints`,
    );
    host.setAttribute("aria-valuemin", "0");
    host.setAttribute("aria-valuemax", String(e.maxHp));
    host.setAttribute("aria-valuenow", String(Math.ceil(e.hp)));
    this.signatures.set(host, signature);
    return true;
  }
  destroy() {
    this.disposed = true;
    this.asset?.geometry.forEach((g) => g.dispose());
    this.asset?.materials.forEach((m) => m.dispose());
    this.asset?.textures.forEach((t) => t.dispose());
    this.asset = null;
    this.data = null;
  }
}
