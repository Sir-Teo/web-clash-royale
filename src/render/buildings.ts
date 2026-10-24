import * as T from "three";
import type { Entity, Team } from "../game/engine";
import { makeMaterial, spriteGeometry } from "./sprites";
import type { SpriteAsset, SpriteData } from "./sprites";
import type { AnimationClip } from "./animation";
import { KING_ACTIVATION_TIME } from "../game/combat";

export interface BuildingSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  asset: SpriteAsset;
  clip: AnimationClip & { labels: Record<string, number> };
  frame: number;
  princess?: {
    front: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
    height: number;
  };
  attached?: {
    front: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
    height: number;
  };
  king?: {
    team: Team;
    turret: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
    front?: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
    aim: number;
  };
}
export class BuildingLibrary {
  assets = new Map<string, SpriteAsset>();
  private princessAsset?: SpriteAsset;
  async load() {
    const loader = new T.TextureLoader();
    await Promise.all(
      ["cannon", "tesla", "mortar", "bomb-tower", "inferno-tower", "king"].map(async (id) => {
        try {
          const response = await fetch(
            `${import.meta.env.BASE_URL}assets/buildings/${id}.json`,
          );
          if (!response.ok) throw new Error(`Missing building ${id}`);
          const data: SpriteData = await response.json();
          const textures = await Promise.all(
            data.textures.map((t) =>
              loader.loadAsync(
                `${import.meta.env.BASE_URL}assets/buildings/${t.file}`,
              ),
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
            // SC buildings include a ground footprint below their authored
            // pivot. Composite the full billboard above opaque terrain; Three
            // still sorts these transparent sprites by their arena position.
            materials: textures.map((texture) => {
              const material = makeMaterial(texture);
              material.depthTest = false;
              return material;
            }),
            geometry: new Map(),
            scale:
              (id === "king" ? 3.5 : id === "mortar" ? 2.8 :
                id === "bomb-tower" ? 2.5 :
                id === "inferno-tower" ? 2.4 : 2.2) /
              (data.bounds[2] - data.bounds[0]),
          });
        } catch (error) {
          console.warn(`Using static building artwork for ${id}`, error);
        }
      }),
    );
  }
  make(id: string, team: Team): BuildingSprite | null {
    let asset = this.assets.get(id === "princess" ? "king" : id);
    if (!asset) return null;
    if (id === "princess") {
      if (!this.princessAsset) {
        const base = spriteGeometry(
          asset,
          asset.data.clips["princess-blue"].frames[0],
        );
        base.computeBoundingBox();
        const width = base.boundingBox!.max.x - base.boundingBox!.min.x;
        // Both tower types share the original sheet and materials, while their
        // frame geometry uses each tower's world scale and authored origin.
        this.princessAsset = {
          ...asset,
          scale: (asset.scale * 2.85) / width,
          geometry: new Map(),
        };
      }
      asset = this.princessAsset;
    }
    const key =
      id === "princess"
        ? `princess-${team}`
        : id === "mortar"
          ? `${team}-idle-1`
          : team;
    const clip = asset.data.clips[key] as BuildingSprite["clip"],
      frame = clip.frames[0];
    const mesh = new T.Mesh(spriteGeometry(asset, frame), asset.materials);
    mesh.renderOrder = 1;
    mesh.userData.billboard = true;
    const sprite: BuildingSprite = { mesh, asset, clip, frame };
    if (id === "princess") {
      const front = new T.Mesh(
        spriteGeometry(asset, asset.data.clips[`${key}-front`].frames[0]),
        asset.materials,
      );
      front.position.z = 0.02;
      front.renderOrder = 1;
      mesh.add(front);
      sprite.princess = {
        front,
        height: asset.data.attachedCharacterHeight ?? 2.2,
      };
    }
    if (id === "bomb-tower") {
      const front = new T.Mesh(
        spriteGeometry(asset, asset.data.clips[`${team}-top`].frames[0]),
        asset.materials,
      );
      front.position.z = 0.02;
      front.renderOrder = 1;
      mesh.add(front);
      sprite.attached = {
        front,
        height: asset.data.attachedCharacterHeight ?? 3.2,
      };
    }
    if (id === "king") {
      const makeLayer = (name: string, depth: number) => {
        const clip = asset.data.clips[`${team}-${name}`];
        if (!clip) return undefined;
        const part = new T.Mesh(
          spriteGeometry(asset, clip.frames[0]),
          asset.materials,
        );
        part.position.z = depth;
        part.renderOrder = 1;
        part.visible = false;
        mesh.add(part);
        return part;
      };
      sprite.king = {
        team,
        turret: makeLayer("turret", 0.01)!,
        front: makeLayer("front", 0.02),
        aim: team === "blue" ? 0 : 35,
      };
    }
    return sprite;
  }
  rubble(king: boolean) {
    const asset = this.assets.get("king");
    if (!asset) return null;
    const clip = asset.data.clips[king ? "rubble-2" : "rubble-1"];
    const mesh = new T.Mesh(
      spriteGeometry(asset, clip.frames[0]),
      asset.materials,
    );
    mesh.renderOrder = 0;
    return mesh;
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
    time = 0,
  ) {
    if (e.card === "cannon" && target) {
      const angle = Math.atan2(target.x - e.x, -(target.y - e.y));
      this.frame(sprite, Math.round((Math.abs(angle) / Math.PI) * 18));
      sprite.mesh.scale.x = angle < 0 ? -1 : 1;
    } else if (e.card === "cannon") {
      this.frame(sprite, e.team === "blue" ? 0 : 18);
      sprite.mesh.scale.x = 1;
    } else if (e.king) {
      const labels = sprite.clip.labels,
        parts = sprite.king!;
      parts.turret.visible = false;
      if (parts.front) parts.front.visible = false;
      const drawLayer = (
        mesh: typeof sprite.mesh,
        name: string,
        frame: number,
      ) => {
        const clip = sprite.asset.data.clips[`${parts.team}-${name}`];
        const index = clip.frames[Math.floor(frame) % clip.frames.length];
        mesh.geometry = spriteGeometry(sprite.asset, index);
        if (mesh === sprite.mesh) sprite.frame = index;
      };
      if (!e.active) drawLayer(sprite.mesh, "sleep", time * sprite.clip.fps);
      else if ((e.activation ?? 0) > 0) {
        const elapsed = KING_ACTIVATION_TIME - e.activation!;
        this.frame(
          sprite,
          Math.min(
            labels.stop,
            labels.start + Math.floor(elapsed * sprite.clip.fps),
          ),
        );
      } else {
        if (target) {
          const angle = Math.atan2(target.x - e.x, -(target.y - e.y));
          parts.aim = Math.min(
            35,
            Math.round((Math.abs(angle) / Math.PI) * 36),
          );
          parts.turret.scale.x = angle < 0 ? -1 : 1;
        }
        drawLayer(sprite.mesh, "base", time * sprite.clip.fps);
        drawLayer(parts.turret, "turret", parts.aim);
        parts.turret.visible = true;
        if (parts.front) {
          drawLayer(parts.front, "front", time * sprite.clip.fps);
          parts.front.visible = true;
        }
      }
    } else if (e.card === "mortar") {
      const angle = target
        ? Math.atan2(target.x - e.x, -(target.y - e.y))
        : e.team === "blue"
          ? 0
          : Math.PI;
      const direction = Math.min(
        5,
        1 + Math.round((Math.abs(angle) / Math.PI) * 4),
      );
      const state =
        e.pendingAttack && e.pendingAttack.remaining < 0.1 ? "attack" : "idle";
      const clip = sprite.asset.data.clips[`${e.team}-${state}-${direction}`];
      if (clip) {
        sprite.clip = clip as BuildingSprite["clip"];
        const progress =
          state === "attack"
            ? Math.floor((0.1 - e.pendingAttack!.remaining) * clip.fps)
            : Math.floor(time * clip.fps);
        this.frame(sprite, progress % clip.frames.length);
      }
      sprite.mesh.scale.x = angle < 0 ? -1 : 1;
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
    const scale =
      e.deploy > 0
        ? Math.max(0.05, 1 - e.deploy / (e.card === "mortar" ? 4 : 1))
        : 1;
    sprite.mesh.scale.set(
      sprite.mesh.scale.x < 0 ? -scale : scale,
      scale,
      scale,
    );
  }
  destroy() {
    this.princessAsset?.geometry.forEach((g) => g.dispose());
    this.princessAsset = undefined;
    for (const asset of this.assets.values()) {
      asset.textures.forEach((t) => t.dispose());
      asset.materials.forEach((m) => m.dispose());
      asset.geometry.forEach((g) => g.dispose());
    }
    this.assets.clear();
  }
}
