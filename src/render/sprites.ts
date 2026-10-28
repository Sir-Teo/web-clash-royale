import { isCharging } from "../game/charge";
import * as T from "three";
import type { CardId } from "../game/cards";
import type { Entity } from "../game/engine";
import executioner from "../game/executioner-data.json" with { type: "json" };
import textureAliases from "./texture-aliases.json" with { type: "json" };
import { facing, selectClip, animationFrame } from "./animation";
import { hasNativeDeployFilter } from "./deploy-filter";
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
  blend?: number;
}
// SC1 DisplayObjectInstance values: normal, multiply, screen, additive.
export const SPRITE_BLENDS = [0, 3, 4, 8] as const;
export type SpriteId = CardId | "tower-princess" | "dark-prince-shield" | "guards-shield";
export interface SpriteData {
  version: 2;
  textures: { file: string; width: number; height: number }[];
  bounds: [number, number, number, number];
  anchor: [number, number];
  attachedCharacterHeight?: number;
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
export const SPRITE_GEOMETRY_BUDGET = 8 * 1024 * 1024;
let geometryUse = 0;
export interface AnimatedSprite {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  asset: SpriteAsset;
  lastFrame: number;
  facingX: number;
  facingY: number;
}
export type SpriteState = Pick<
  Entity,
  "id" | "card" | "team" | "x" | "y" | "attack" | "interval" | "move" | "chargeDistance" | "deploy" | "dash" | "dashCharge"
> & { animationTime?: number };
const heights: Partial<Record<SpriteId, number>> = {
  knight: 1.65,
  barbarians: 1.75,
  "elite-barbarians": 1.75,
  wizard: 1.8,
  "ice-wizard": 1.8,
  "ice-spirit": 1.05,
  "fire-spirits": 1.25,
  "ice-golem": 1.75,
  princess: 1.7,
  archers: 1.55,
  giant: 2.7,
  "giant-skeleton": 2.8,
  golem: 3.3,
  golemite: 1.55,
  "lava-hound": 3.0,
  "lava-pup": 1.3,
  "royal-giant": 2.8,
  musketeer: 1.9,
  "mini-pekka": 1.75,
  goblins: 1.3,
  "dart-goblin": 1.5,
  "spear-goblins": 1.35,
  skeletons: 1.15,
  guards: 1.45,
  "guards-shield": 1.45,
  bomber: 1.5,
  valkyrie: 1.9,
  "hog-rider": 2.1,
  "baby-dragon": 2.3,
  minions: 1.5,
  "mega-minion": 2,
  "inferno-dragon": 2.05,
  "electro-wizard": 1.8,
  miner: 1.65,
  bowler: 2.4,
  "dark-prince": 2.1,
  "dark-prince-shield": 2.1,
  "battle-ram": 2.5,
  executioner: 2.2,
  sparky: 2.3,
  lumberjack: 2.1,
  bats: 1.15,
  "night-witch": 1.95,
  bandit: 1.75,
  witch: 2.1,
  prince: 2.25,
  pekka: 2.7,
  balloon: 4,
  "tower-princess": 1.35,
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
export function effectMaterials(
  textures: T.Texture[],
  create: (texture: T.Texture) => T.MeshBasicMaterial = makeMaterial,
) {
  return SPRITE_BLENDS.flatMap((blend) =>
    textures.map((texture) => {
      const material = create(texture);
      if (blend === 8) material.blending = T.AdditiveBlending;
      if (blend === 3 || blend === 4) {
        // Premultiplied source alpha keeps soft edges neutral for multiply/screen.
        material.premultipliedAlpha = true;
        material.blending = T.CustomBlending;
        material.blendSrc = blend === 3 ? T.DstColorFactor : T.OneFactor;
        material.blendDst =
          blend === 3 ? T.OneMinusSrcAlphaFactor : T.OneMinusSrcColorFactor;
        material.blendSrcAlpha = T.OneFactor;
        material.blendDstAlpha = T.OneMinusSrcAlphaFactor;
      }
      return material;
    }),
  );
}
export function spriteGeometry(asset: SpriteAsset, index: number) {
  const cached = asset.geometry.get(index);
  if (cached) {
    cached.userData.spriteLastUse = ++geometryUse;
    return cached;
  }
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
      const blend = SPRITE_BLENDS.indexOf(
        (part.blend ?? 0) as (typeof SPRITE_BLENDS)[number],
      );
      if (blend < 0) throw new Error(`Unsupported sprite blend ${part.blend}`);
      const material = polygon.sheet + blend * asset.textures.length;
      if (material !== sheet) {
        if (sheet >= 0)
          geometry.addGroup(start, positions.length / 3 - start, sheet);
        sheet = material;
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
  geometry.userData.spriteFrameBytes =
    (positions.length + uvs.length + multiply.length + add.length) *
    Float32Array.BYTES_PER_ELEMENT;
  geometry.userData.spriteLastUse = ++geometryUse;
  asset.geometry.set(index, geometry);
  return geometry;
}

export class SpriteLibrary {
  assets = new Map<SpriteId, SpriteAsset>();
  private loader = new T.TextureLoader();
  async load() {
    const textureLoads = new Map<string, Promise<T.Texture>>();
    const loadTexture = (file: string) => {
      const canonical = (textureAliases as Record<string, string>)[file] ?? file;
      let pending = textureLoads.get(canonical);
      if (!pending) {
        pending = this.loader.loadAsync(
          `${import.meta.env.BASE_URL}assets/animations/${canonical}`,
        ).then((texture) => {
          texture.colorSpace = T.SRGBColorSpace;
          texture.minFilter = T.LinearFilter;
          texture.magFilter = T.LinearFilter;
          texture.generateMipmaps = false;
          return texture;
        });
        textureLoads.set(canonical, pending);
      }
      return pending;
    };
    await Promise.all(
      (Object.keys(heights) as SpriteId[]).map(async (id) => {
        try {
          const response = await fetch(
            `${import.meta.env.BASE_URL}assets/animations/${id}.json`,
          );
          if (!response.ok) throw new Error(`Missing animation ${id}`);
          const data: SpriteData = await response.json();
          const textures = await Promise.all(data.textures.map((t) => loadTexture(t.file)));
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
  make(id: SpriteId): AnimatedSprite | null {
    const asset = this.assets.get(
      id === "skeleton-army" ? "skeletons" :
      id === "minion-horde" ? "minions" :
      id === "three-musketeers" ? "musketeer" : id,
    );
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
    if (e.card === "bandit" && e.dash?.goal) {
      sprite.facingX = e.dash.goal.x - e.x;
      sprite.facingY = e.dash.goal.y - e.y;
    } else if (e.card === "bandit" && e.dashCharge && target) {
      sprite.facingX = target.x - e.x;
      sprite.facingY = target.y - e.y;
    } else if (e.attack > 0 && !moving && target) {
      sprite.facingX = target.x - e.x;
      sprite.facingY = target.y - e.y;
    } else if (moving && motion && Math.hypot(motion.x, motion.y) > 0.0001) {
      sprite.facingX = motion.x;
      sprite.facingY = motion.y;
    } else if (!sprite.facingX && !sprite.facingY) {
      sprite.facingY = e.team === "blue" ? -1 : 1;
    }
    const { direction, flip } = facing(sprite.facingX, sprite.facingY);
    const attackAge = e.interval - e.attack;
    const kind =
      e.card === "bandit" && e.dash ? "dash" :
      e.card === "lumberjack" && e.deploy > 0 ? "deploy" :
      e.attack > 0 && !moving
        ? e.card === "executioner" && attackAge >= 1 ? "attacking" : "attack"
        : moving
          ? isCharging(e)
            ? "charge"
            : "run"
          : "idle";
    const clip = selectClip(sprite.asset.data.clips, e.team, kind, direction);
    const elapsed = kind === "dash" ? e.dash!.elapsed :
      kind === "deploy" ? 1 - e.deploy :
      kind === "attack" ? attackAge :
      kind === "attacking" ? attackAge - 1 : (e.animationTime ?? time) + e.id * 0.13;
    const frame = animationFrame(clip, elapsed,
      kind === "attack" || kind === "attacking" || kind === "deploy" || kind === "dash",
      kind === "dash" ? 0.7 : kind === "deploy" ? 1 :
        kind === "attacking" ? executioner.projectile.visualTime : e.interval);
    if (frame !== sprite.lastFrame) {
      sprite.mesh.geometry = spriteGeometry(sprite.asset, frame);
      sprite.lastFrame = frame;
    }
    sprite.mesh.quaternion.copy(camera.quaternion);
    const scale =
      e.deploy > 0 && !hasNativeDeployFilter(e.card) && e.card !== "lumberjack"
        ? Math.max(0.05, 1 - e.deploy)
        : 1;
    sprite.mesh.scale.set(flip ? -scale : scale, scale, scale);
  }
  private geometryEntries() {
    return [...new Set(this.assets.values())].flatMap((asset) =>
      [...asset.geometry].map(([frame, geometry]) => ({
        asset, frame, geometry,
        bytes: Number(geometry.userData.spriteFrameBytes ?? 0),
        used: Number(geometry.userData.spriteLastUse ?? 0),
      })),
    );
  }

  get geometryCacheState() {
    let frames = 0, bytes = 0;
    for (const asset of new Set(this.assets.values()))
      for (const geometry of asset.geometry.values()) {
        frames++;
        bytes += Number(geometry.userData.spriteFrameBytes ?? 0);
      }
    return { frames, bytes };
  }

  /** Call only after scene consumers and sprite instance batches are released. */
  trimGeometryCache(budgetBytes = SPRITE_GEOMETRY_BUDGET) {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0)
      throw new RangeError("Invalid sprite geometry budget");
    const entries = this.geometryEntries();
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let releasedFrames = 0, releasedBytes = 0;
    if (bytes <= budgetBytes) return { releasedFrames, releasedBytes };
    entries.sort((a, b) => a.used - b.used);
    for (const entry of entries) {
      if (bytes <= budgetBytes) break;
      entry.asset.geometry.delete(entry.frame);
      entry.geometry.dispose();
      bytes -= entry.bytes;
      releasedBytes += entry.bytes;
      releasedFrames++;
    }
    return { releasedFrames, releasedBytes };
  }

  destroy() {
    for (const asset of this.assets.values()) {
      asset.materials.forEach((material) => material.dispose());
      asset.geometry.forEach((geometry) => geometry.dispose());
    }
    for (const texture of new Set([...this.assets.values()].flatMap((asset) => asset.textures)))
      texture.dispose();
    this.assets.clear();
  }
}
