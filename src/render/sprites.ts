import * as T from "three";
import type { CardId } from "../game/cards";
import type { Entity } from "../game/engine";
interface SpriteData {
  width: number;
  height: number;
  cell: number;
  anchor: [number, number];
  clips: Record<string, number[]>;
  frames: Record<string, [number, number, number, number]>;
}
interface SpriteAsset {
  data: SpriteData;
  texture: T.Texture;
  material: T.MeshBasicMaterial;
}
export interface AnimatedSprite {
  mesh: T.Mesh;
  asset: SpriteAsset;
  size: number;
  lastFrame: number;
  lastFlip: boolean;
}
const ids: CardId[] = [
  "knight",
  "archers",
  "giant",
  "musketeer",
  "mini-pekka",
  "goblins",
  "spear-goblins",
  "skeletons",
  "bomber",
  "valkyrie",
  "hog-rider",
  "baby-dragon",
  "minions",
  "witch",
  "prince",
  "pekka",
  "wizard",
];
const sizes: Partial<Record<CardId, number>> = {
  knight: 4.2,
  wizard: 4.4,
  archers: 3.9,
  giant: 6,
  musketeer: 4.3,
  "mini-pekka": 4,
  goblins: 3.3,
  "spear-goblins": 3.4,
  skeletons: 3.1,
  bomber: 3.7,
  valkyrie: 4.3,
  "hog-rider": 5,
  "baby-dragon": 5.3,
  minions: 3.5,
  witch: 5,
  prince: 5.3,
  pekka: 6,
};
export class SpriteLibrary {
  assets = new Map<CardId, SpriteAsset>();
  private loader = new T.TextureLoader();
  async load() {
    await Promise.all(
      ids.map(async (id) => {
        try {
          const [data, texture] = await Promise.all([
            fetch(`/assets/sprites/${id}.json`).then((r) => {
              if (!r.ok) throw new Error();
              return r.json() as Promise<SpriteData>;
            }),
            this.loader.loadAsync(`/assets/sprites/${id}.png`),
          ]);
          texture.colorSpace = T.SRGBColorSpace;
          texture.minFilter = T.LinearFilter;
          texture.magFilter = T.LinearFilter;
          texture.generateMipmaps = false;
          const material = new T.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.05,
            depthWrite: false,
            toneMapped: false,
            side: T.DoubleSide,
          });
          this.assets.set(id, { data, texture, material });
        } catch {
          /* The procedural model is retained if an imported atlas is unavailable. */
        }
      }),
    );
  }
  make(id: CardId): AnimatedSprite | null {
    const key = id === "skeleton-army" ? "skeletons" : id;
    const asset = this.assets.get(key);
    if (!asset) return null;
    const size = sizes[key] ?? 4.2;
    const geometry = new T.PlaneGeometry(size, size);
    geometry.translate(
      (0.5 - asset.data.anchor[0]) * size,
      (0.5 - asset.data.anchor[1]) * size,
      0,
    );
    const mesh = new T.Mesh(geometry, asset.material);
    mesh.renderOrder = 1;
    return { mesh, asset, size, lastFrame: -1, lastFlip: false };
  }
  update(
    sprite: AnimatedSprite,
    e: Entity,
    target: Entity | undefined,
    moving: boolean,
    time: number,
    camera: T.Camera,
  ) {
    const { data } = sprite.asset;
    const dx = target ? target.x - e.x : 0,
      dy = target ? target.y - e.y : e.team === "blue" ? -1 : 1;
    const angle = Math.atan2(dx, -dy);
    const direction = 1 + Math.round((Math.abs(angle) / Math.PI) * 4) * 2;
    const flip = dx < 0;
    const kind = e.attack > 0 ? "attack" : moving ? "run" : "idle";
    const team = e.team;
    const clips = data.clips;
    const sequence =
      clips[`${team}-${kind}-${direction}`] ??
      clips[`${team}-run-${direction}`] ??
      clips[`blue-${kind}-${direction}`] ??
      clips[`blue-run-${direction}`] ??
      Object.values(clips)[0];
    const index =
      kind === "attack"
        ? Math.min(
            sequence.length - 1,
            Math.floor((1 - e.attack / 0.3) * sequence.length),
          )
        : Math.floor((time + e.id * 0.13) * 7) % sequence.length;
    const frame = sequence[index];
    if (frame !== sprite.lastFrame || flip !== sprite.lastFlip) {
      const [x, y, w, h] = data.frames[frame];
      const uv = sprite.mesh.geometry.attributes.uv;
      const left = x / data.width,
        right = (x + w) / data.width,
        bottom = 1 - (y + h) / data.height,
        top = 1 - y / data.height;
      uv.setXY(0, flip ? right : left, top);
      uv.setXY(1, flip ? left : right, top);
      uv.setXY(2, flip ? right : left, bottom);
      uv.setXY(3, flip ? left : right, bottom);
      uv.needsUpdate = true;
      sprite.lastFrame = frame;
      sprite.lastFlip = flip;
    }
    sprite.mesh.quaternion.copy(camera.quaternion);
    const scale = e.deploy > 0 ? Math.max(0.05, 1 - e.deploy) : 1;
    sprite.mesh.scale.setScalar(scale);
  }
  destroy() {
    for (const a of this.assets.values()) {
      a.texture.dispose();
      a.material.dispose();
    }
    this.assets.clear();
  }
}
