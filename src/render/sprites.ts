import * as T from "three";
import type { CardId } from "../game/cards";
import type { Entity } from "../game/engine";
import { facing, selectClip, animationFrame } from "./animation";
import type { AnimationClip } from "./animation";
interface Polygon {
  sheet: number;
  xy: [number, number][];
  uv: [number, number][];
}
interface FramePart {
  shape: number;
  matrix: number[];
  color: number[];
}
export interface SpriteData {
  version: 2;
  textures: { file: string; width: number; height: number }[];
  bounds: [number, number, number, number];
  anchor: [number, number];
  shapes: Record<number, Polygon[]>;
  clips: Record<string, AnimationClip>;
  frames: FramePart[][];
}
export interface SpriteAsset {
  data: SpriteData;
  textures: T.Texture[];
  materials: T.MeshBasicMaterial[];
  geometry: Map<number, T.BufferGeometry>;
  scale: number;
}
export interface AnimatedSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  asset: SpriteAsset;
  lastFrame: number;
  facingX: number;
  facingY: number;
}
export type SpriteState = Pick<
  Entity,
  "id" | "card" | "team" | "x" | "y" | "attack" | "interval" | "move" | "deploy"
>;
const heights: Partial<Record<CardId, number>> = {
  knight: 1.65,
  wizard: 1.8,
  archers: 1.55,
  giant: 2.7,
  musketeer: 1.9,
  "mini-pekka": 1.75,
  goblins: 1.3,
  "spear-goblins": 1.35,
  skeletons: 1.15,
  bomber: 1.5,
  valkyrie: 1.9,
  "hog-rider": 2.1,
  "baby-dragon": 2.3,
  minions: 1.5,
  witch: 2.1,
  prince: 2.25,
  pekka: 2.7,
  balloon: 4,
};
export function makeMaterial(texture: T.Texture) {
  const material = new T.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    toneMapped: false,
    side: T.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `attribute vec4 scMultiply; attribute vec3 scAdd;
      varying vec4 vScMultiply; varying vec3 vScAdd;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvScMultiply = scMultiply; vScAdd = scAdd;",
    );
    shader.fragmentShader =
      "varying vec4 vScMultiply; varying vec3 vScAdd;\n" +
      shader.fragmentShader;
    // SC colors operate on source sRGB values. Three samples sRGB textures in linear space.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec4 sourceColor = sRGBTransferOETF(diffuseColor);
      sourceColor.rgb = clamp(sourceColor.rgb * vScMultiply.rgb + vScAdd, 0.0, 1.0);
      sourceColor.a *= vScMultiply.a;
      diffuseColor = sRGBTransferEOTF(sourceColor);`,
    );
  };
  material.customProgramCacheKey = () => "sc1-color-transform-v1";
  return material;
}
export function spriteGeometry(asset: SpriteAsset, index: number) {
  const cached = asset.geometry.get(index);
  if (cached) return cached;
  const positions: number[] = [],
    uvs: number[] = [],
    multiply: number[] = [],
    add: number[] = [];
  const geometry = new T.BufferGeometry();
  let sheet = -1,
    start = 0;
  asset.data.frames[index].forEach((part, layer) => {
    const m = part.matrix,
      c = part.color;
    for (const polygon of asset.data.shapes[part.shape]) {
      if (polygon.sheet !== sheet) {
        if (sheet >= 0)
          geometry.addGroup(start, positions.length / 3 - start, sheet);
        sheet = polygon.sheet;
        start = positions.length / 3;
      }
      for (let j = 1; j < polygon.xy.length - 1; j++)
        for (const vertex of [0, j, j + 1]) {
          const [x, y] = polygon.xy[vertex],
            [u, v] = polygon.uv[vertex];
          positions.push(
            (m[0] * x + m[2] * y + m[4] - asset.data.anchor[0]) * asset.scale,
            -(m[1] * x + m[3] * y + m[5] - asset.data.anchor[1]) * asset.scale,
            layer * 0.0005,
          );
          uvs.push(u, 1 - v);
          multiply.push(c[4] / 255, c[5] / 255, c[6] / 255, c[3] / 255);
          add.push(c[0] / 255, c[1] / 255, c[2] / 255);
        }
    }
  });
  if (sheet >= 0) geometry.addGroup(start, positions.length / 3 - start, sheet);
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "scMultiply",
    new T.Float32BufferAttribute(multiply, 4),
  );
  geometry.setAttribute("scAdd", new T.Float32BufferAttribute(add, 3));
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;
  asset.geometry.set(index, geometry);
  return geometry;
}

export class SpriteLibrary {
  assets = new Map<CardId, SpriteAsset>();
  private loader = new T.TextureLoader();
  async load() {
    await Promise.all(
      (Object.keys(heights) as CardId[]).map(async (id) => {
        try {
          const response = await fetch(`/assets/animations/${id}.json`);
          if (!response.ok) throw new Error(`Missing animation ${id}`);
          const data: SpriteData = await response.json();
          const textures = await Promise.all(
            data.textures.map((t) =>
              this.loader.loadAsync(`/assets/animations/${t.file}`),
            ),
          );
          for (const texture of textures) {
            texture.colorSpace = T.SRGBColorSpace;
            texture.minFilter = T.LinearFilter;
            texture.magFilter = T.LinearFilter;
            texture.generateMipmaps = false;
          }
          this.assets.set(id, {
            data,
            textures,
            materials: textures.map(makeMaterial),
            geometry: new Map(),
            scale: heights[id]! / (data.bounds[3] - data.bounds[1]),
          });
        } catch (error) {
          console.warn(`Using fallback model for ${id}`, error);
        }
      }),
    );
  }
  make(id: CardId): AnimatedSprite | null {
    const asset = this.assets.get(id === "skeleton-army" ? "skeletons" : id);
    if (!asset) return null;
    const frame = Object.values(asset.data.clips)[0].frames[0];
    const mesh = new T.Mesh(spriteGeometry(asset, frame), asset.materials);
    mesh.renderOrder = 1;
    return { mesh, asset, lastFrame: frame, facingX: 0, facingY: 0 };
  }
  update(
    sprite: AnimatedSprite,
    e: SpriteState,
    target: { x: number; y: number } | undefined,
    moving: boolean,
    time: number,
    camera: T.Camera,
    motion?: { x: number; y: number },
  ) {
    if (e.attack > 0 && !moving && target) {
      sprite.facingX = target.x - e.x;
      sprite.facingY = target.y - e.y;
    } else if (moving && motion && Math.hypot(motion.x, motion.y) > 0.0001) {
      sprite.facingX = motion.x;
      sprite.facingY = motion.y;
    } else if (!sprite.facingX && !sprite.facingY) {
      sprite.facingY = e.team === "blue" ? -1 : 1;
    }
    const { direction, flip } = facing(sprite.facingX, sprite.facingY);
    const kind =
      e.attack > 0 && !moving
        ? "attack"
        : moving
          ? e.card === "prince" && e.move > 2.3
            ? "charge"
            : "run"
          : "idle";
    const clip = selectClip(sprite.asset.data.clips, e.team, kind, direction);
    const elapsed =
      kind === "attack" ? e.interval - e.attack : time + e.id * 0.13;
    const frame = animationFrame(clip, elapsed, kind === "attack", e.interval);
    if (frame !== sprite.lastFrame) {
      sprite.mesh.geometry = spriteGeometry(sprite.asset, frame);
      sprite.lastFrame = frame;
    }
    sprite.mesh.quaternion.copy(camera.quaternion);
    const scale = e.deploy > 0 ? Math.max(0.05, 1 - e.deploy) : 1;
    sprite.mesh.scale.set(flip ? -scale : scale, scale, scale);
  }
  destroy() {
    for (const asset of this.assets.values()) {
      asset.textures.forEach((texture) => texture.dispose());
      asset.materials.forEach((material) => material.dispose());
      asset.geometry.forEach((geometry) => geometry.dispose());
    }
    this.assets.clear();
  }
}
