import * as T from "three";
import type { AnimatedSprite } from "./sprites";

export interface SpriteFilterColor {
  add: T.Vector3;
  multiply: T.Vector4;
}

/** Apply an actor-local SC color transform after the artwork's own transform. */
export function filteredSpriteMaterials(
  originals: readonly T.MeshBasicMaterial[],
  color: SpriteFilterColor,
) {
  return originals.map((original) => {
    const material = original.clone();
    material.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile(shader, renderer);
      shader.uniforms.scFilterAdd = { value: color.add };
      shader.uniforms.scFilterMultiply = { value: color.multiply };
      const before = "sourceColor.a *= vScMultiply.a;";
      if (!shader.fragmentShader.includes(before))
        throw new Error("Missing SC color transform in sprite filter material");
      shader.fragmentShader =
        "uniform vec3 scFilterAdd; uniform vec4 scFilterMultiply;\n" +
        shader.fragmentShader.replace(
          before,
          `sourceColor.rgb = clamp(sourceColor.rgb * scFilterMultiply.rgb + scFilterAdd, 0.0, 1.0);\n      ${before}\n      sourceColor.a *= scFilterMultiply.a;`,
        );
    };
    material.customProgramCacheKey = () => "sc1-sprite-filter-v1";
    return material;
  });
}

export type SpriteFilterLayer =
  "deploy" | "clone" | "charge" | "rage" | "poison" | "cold";
const layerOrder: SpriteFilterLayer[] = [
  "deploy",
  "clone",
  "charge",
  "rage",
  "poison",
  "cold",
];

export function composeFilterColors(colors: readonly (readonly number[])[]) {
  let ar = 0,
    ag = 0,
    ab = 0;
  let mr = 1,
    mg = 1,
    mb = 1,
    ma = 1;
  for (const color of colors) {
    const [lr, lg, lb, la, lmr, lmg, lmb] = color;
    const r = lmr / 255,
      g = lmg / 255,
      b = lmb / 255;
    ar = ar * r + lr / 255;
    ag = ag * g + lg / 255;
    ab = ab * b + lb / 255;
    mr *= r;
    mg *= g;
    mb *= b;
    ma *= la / 255;
  }
  return {
    add: [ar, ag, ab] as [number, number, number],
    multiply: [mr, mg, mb, ma] as [number, number, number, number],
  };
}

interface FilteredSprite {
  sprite: AnimatedSprite;
  materials: T.MeshBasicMaterial[];
  add: T.Vector3;
  multiply: T.Vector4;
  layers: Map<SpriteFilterLayer, readonly number[]>;
}

/** Compose simultaneous native color transforms without replacing each other's materials. */
export class SpriteFilterStack {
  private sprites = new Map<number, FilteredSprite>();

  get state() {
    return [...this.sprites.entries()].map(([id, sprite]) => ({
      id,
      layers: layerOrder.filter((layer) => sprite.layers.has(layer)),
      add: sprite.add.toArray(),
      multiply: sprite.multiply.toArray(),
    }));
  }

  has(id: number, layer: SpriteFilterLayer) {
    return this.sprites.get(id)?.layers.has(layer) ?? false;
  }

  set(
    id: number,
    layer: SpriteFilterLayer,
    sprite: AnimatedSprite,
    color: readonly number[],
  ) {
    let filtered = this.sprites.get(id);
    if (filtered?.sprite !== sprite) {
      if (filtered) this.release(filtered);
      filtered = {
        sprite,
        materials: [],
        add: new T.Vector3(),
        multiply: new T.Vector4(1, 1, 1, 1),
        layers: new Map(),
      };
      filtered.materials = filteredSpriteMaterials(
        sprite.asset.materials,
        filtered,
      );
      sprite.mesh.material = filtered.materials;
      this.sprites.set(id, filtered);
    }
    filtered.layers.set(layer, color);
    this.compose(filtered);
  }

  remove(id: number, layer: SpriteFilterLayer) {
    const filtered = this.sprites.get(id);
    if (!filtered?.layers.delete(layer)) return;
    if (filtered.layers.size) this.compose(filtered);
    else {
      this.release(filtered);
      this.sprites.delete(id);
    }
  }

  clear() {
    for (const filtered of this.sprites.values()) this.release(filtered);
    this.sprites.clear();
  }

  private compose(filtered: FilteredSprite) {
    const color = composeFilterColors(
      layerOrder.flatMap((layer) => {
        const value = filtered.layers.get(layer);
        return value ? [value] : [];
      }),
    );
    filtered.add.set(...color.add);
    filtered.multiply.set(...color.multiply);
  }

  private release(filtered: FilteredSprite) {
    if (filtered.sprite.mesh.material === filtered.materials)
      filtered.sprite.mesh.material = filtered.sprite.asset.materials;
    filtered.materials.forEach((material) => material.dispose());
  }
}
