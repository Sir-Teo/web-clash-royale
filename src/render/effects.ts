import * as T from "three";
import { makeMaterial, spriteGeometry } from "./sprites";
import type { SpriteData, SpriteAsset } from "./sprites";

export interface EffectSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  name: string;
  frame: number;
}
export class EffectLibrary {
  asset: SpriteAsset | null = null;
  async load() {
    try {
      const response = await fetch("/assets/effects/effects.json");
      if (!response.ok) throw new Error("Missing native effects");
      const data: SpriteData = await response.json();
      const loader = new T.TextureLoader();
      const textures = await Promise.all(
        data.textures.map((t) => loader.loadAsync(`/assets/effects/${t.file}`)),
      );
      for (const texture of textures) {
        texture.colorSpace = T.SRGBColorSpace;
        texture.minFilter = texture.magFilter = T.LinearFilter;
        texture.generateMipmaps = false;
      }
      this.asset = {
        data,
        textures,
        materials: textures.map(makeMaterial),
        geometry: new Map(),
        scale: 1 / 30,
      };
    } catch (error) {
      console.warn("Using fallback projectile artwork", error);
    }
  }
  make(name: string): EffectSprite | null {
    const a = this.asset,
      clip = a?.data.clips[name];
    if (!a || !clip) return null;
    const frame = clip.frames[0];
    const mesh = new T.Mesh(spriteGeometry(a, frame), a.materials);
    mesh.renderOrder = 2;
    return { mesh, name, frame };
  }
  frame(sprite: EffectSprite, index: number) {
    const a = this.asset;
    if (!a) return;
    const frames = a.data.clips[sprite.name].frames;
    const frame =
      frames[Math.max(0, Math.min(frames.length - 1, Math.floor(index)))];
    if (frame !== sprite.frame) {
      sprite.mesh.geometry = spriteGeometry(a, frame);
      sprite.frame = frame;
    }
  }
  animate(sprite: EffectSprite, seconds: number, loop = false) {
    const clip = this.asset?.data.clips[sprite.name];
    if (!clip) return;
    const index = Math.floor(seconds * clip.fps);
    this.frame(sprite, loop ? index % clip.frames.length : index);
  }
  destroy() {
    this.asset?.textures.forEach((t) => t.dispose());
    this.asset?.materials.forEach((m) => m.dispose());
    this.asset?.geometry.forEach((g) => g.dispose());
    this.asset = null;
  }
}
