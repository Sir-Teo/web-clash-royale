import * as T from "three";
import type { Entity, Team } from "../game/engine";
import { makeMaterial, spriteGeometry } from "./sprites";
import type { SpriteAsset, SpriteData } from "./sprites";
import type { AnimationClip } from "./animation";

export interface BuildingSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  asset: SpriteAsset;
  clip: AnimationClip & { labels: Record<string, number> };
  frame: number;
}
export class BuildingLibrary {
  assets = new Map<string, SpriteAsset>();
  async load() {
    const loader = new T.TextureLoader();
    await Promise.all(
      ["cannon", "tesla"].map(async (id) => {
        try {
          const response = await fetch(`/assets/buildings/${id}.json`);
          if (!response.ok) throw new Error(`Missing building ${id}`);
          const data: SpriteData = await response.json();
          const textures = await Promise.all(
            data.textures.map((t) =>
              loader.loadAsync(`/assets/buildings/${t.file}`),
            ),
          );
          for (const texture of textures) {
            texture.colorSpace = T.SRGBColorSpace;
            texture.minFilter = texture.magFilter = T.LinearFilter;
            texture.generateMipmaps = false;
          }
          this.assets.set(id, {
            data,
            textures,
            materials: textures.map(makeMaterial),
            geometry: new Map(),
            scale: 2.2 / (data.bounds[2] - data.bounds[0]),
          });
        } catch (error) {
          console.warn(`Using static building artwork for ${id}`, error);
        }
      }),
    );
  }
  make(id: string, team: Team): BuildingSprite | null {
    const asset = this.assets.get(id);
    if (!asset) return null;
    const clip = asset.data.clips[team] as BuildingSprite["clip"],
      frame = clip.frames[0];
    const mesh = new T.Mesh(spriteGeometry(asset, frame), asset.materials);
    mesh.renderOrder = 1;
    mesh.userData.billboard = true;
    return { mesh, asset, clip, frame };
  }
  frame(sprite: BuildingSprite, index: number) {
    const frame =
      sprite.clip.frames[
        Math.min(sprite.clip.frames.length - 1, Math.max(0, Math.round(index)))
      ];
    if (frame !== sprite.frame) {
      sprite.mesh.geometry = spriteGeometry(sprite.asset, frame);
      sprite.frame = frame;
    }
  }
  update(
    sprite: BuildingSprite,
    e: Entity,
    target: Entity | undefined,
    camera: T.Camera,
  ) {
    if (e.card === "cannon" && target) {
      const angle = Math.atan2(target.x - e.x, -(target.y - e.y));
      this.frame(sprite, Math.round((Math.abs(angle) / Math.PI) * 18));
      sprite.mesh.scale.x = angle < 0 ? -1 : 1;
    } else if (e.card === "cannon") {
      this.frame(sprite, e.team === "blue" ? 0 : 18);
      sprite.mesh.scale.x = 1;
    } else if (e.card === "tesla") {
      const labels = sprite.clip.labels,
        state = e.burrow;
      if (e.deploy > 0 || !state) this.frame(sprite, labels.deploy);
      else if (state.phase === "hidden") this.frame(sprite, labels.idle);
      else if (state.phase === "sinking")
        this.frame(
          sprite,
          labels.hide_start +
            (1 - state.exposure) * (labels.hide_end - labels.hide_start),
        );
      else
        this.frame(
          sprite,
          labels.appear_start +
            state.exposure * (labels.appear_end - labels.appear_start),
        );
    }
    sprite.mesh.quaternion.copy(camera.quaternion);
    const scale = e.deploy > 0 ? Math.max(0.05, 1 - e.deploy) : 1;
    sprite.mesh.scale.set(
      sprite.mesh.scale.x < 0 ? -scale : scale,
      scale,
      scale,
    );
  }
  destroy() {
    for (const asset of this.assets.values()) {
      asset.textures.forEach((t) => t.dispose());
      asset.materials.forEach((m) => m.dispose());
      asset.geometry.forEach((g) => g.dispose());
    }
    this.assets.clear();
  }
}
