import * as T from "three";
import type { BattleEvent, Entity, Team } from "../game/engine";
import { facing, selectClip } from "./animation";
import { spriteGeometry, type SpriteAsset } from "./sprites";
import source from "./bandit-trail-data.json";

export interface BanditAfterimage {
  key: string;
  x: number;
  y: number;
  team: Team;
  direction: number;
  flip: boolean;
  age: number;
  life: number;
  opacity: number;
}

/** Derive native emitter samples from replayable dash events, including late peer snapshots. */
export function banditAfterimages(
  events: readonly BattleEvent[], entities: readonly Entity[], time: number,
): BanditAfterimage[] {
  const result: BanditAfterimage[] = [];
  const starts = events.filter((event) => event.effect === "dash-start:bandit" &&
    event.value && time - event.time <= source.life[1] +
      (source.count - 1) * source.interval);
  for (const start of starts) {
    const end = events.find((event) => event.effect === "dash-end:bandit" &&
      event.value === start.value && event.time >= start.time);
    const actor = entities.find((entity) => entity.id === start.value);
    const endpoint = end ?? (actor?.dash ? actor : undefined);
    if (!endpoint) continue;
    const dx = endpoint.x - start.x, dy = endpoint.y - start.y;
    const { direction, flip } = facing(dx, dy);
    const duration = end ? end.time - start.time : actor?.dash?.elapsed ?? 0;
    for (let index = 0; index < source.count; index++) {
      const delay = index * source.interval;
      if (end && delay > duration + 1e-8) continue;
      if (!end && delay > duration + 1e-8) continue;
      const age = time - start.time - delay;
      const life = source.life[0] +
        (((start.id * 17 + index * 13) % 8) / 7) *
        (source.life[1] - source.life[0]);
      if (age < 0 || age >= life) continue;
      const progress = duration > 0 ? Math.min(1, delay / duration) : 0;
      result.push({
        key: `${start.id}-${index}`,
        x: start.x + dx * progress,
        y: start.y + dy * progress,
        team: start.team,
        direction,
        flip,
        age,
        life,
        opacity: Math.max(0, 1 - age / Math.min(life, source.fadeOut)) * 0.7,
      });
    }
  }
  return result;
}

interface TrailSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  materials: T.MeshBasicMaterial[];
}

export class NativeBanditTrail {
  private sprites = new Map<string, TrailSprite>();
  private visible: BanditAfterimage[] = [];

  constructor(private scene: T.Scene) {}

  get state() { return this.visible; }

  update(
    events: readonly BattleEvent[], entities: readonly Entity[], time: number,
    asset: SpriteAsset | undefined, camera: T.Camera,
  ) {
    this.visible = asset ? banditAfterimages(events, entities, time) : [];
    const active = new Set<string>();
    for (const image of this.visible) {
      active.add(image.key);
      const clip = selectClip(asset!.data.clips, image.team, "dash", image.direction);
      const frame = clip.frames[Math.min(clip.frames.length - 1,
        Math.floor(image.age * clip.fps + 1e-6))];
      let visual = this.sprites.get(image.key);
      if (!visual) {
        const materials = asset!.materials.map((material) => {
          const copy = material.clone();
          copy.transparent = true;
          copy.depthWrite = false;
          return copy;
        });
        const mesh = new T.Mesh(spriteGeometry(asset!, frame), materials);
        mesh.renderOrder = 1;
        this.scene.add(mesh);
        visual = { mesh, materials };
        this.sprites.set(image.key, visual);
      }
      visual.mesh.geometry = spriteGeometry(asset!, frame);
      visual.mesh.position.set(image.x - 9, 0.2, image.y - 16);
      visual.mesh.quaternion.copy(camera.quaternion);
      visual.mesh.scale.set(image.flip ? -1 : 1, 1, 1);
      for (const material of visual.materials) material.opacity = image.opacity;
    }
    for (const [key, visual] of this.sprites)
      if (!active.has(key)) {
        this.scene.remove(visual.mesh);
        visual.materials.forEach((material) => material.dispose());
        this.sprites.delete(key);
      }
  }

  clear() {
    for (const visual of this.sprites.values()) {
      this.scene.remove(visual.mesh);
      visual.materials.forEach((material) => material.dispose());
    }
    this.sprites.clear();
    this.visible = [];
  }
}
