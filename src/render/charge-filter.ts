import * as T from "three";
import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import source from "./charge-filter-data.json";

const life = source.colors.length / source.fps;
type Color = (typeof source.colors)[number];
interface FilteredActor {
  start: number;
  frame: number;
  sprite?: AnimatedSprite;
  materials?: T.MeshBasicMaterial[];
  add: T.Vector3;
  multiply: T.Vector3;
}

export function chargeFilterFrame(age: number) {
  return age >= 0 && age < life
    ? Math.min(source.colors.length - 1, Math.floor(age * source.fps))
    : -1;
}

export function chargeFilterColor(age: number): Color | null {
  const frame = chargeFilterFrame(age);
  return frame < 0 ? null : source.colors[frame];
}

function filteredMaterial(
  original: T.MeshBasicMaterial,
  add: T.Vector3,
  multiply: T.Vector3,
) {
  const material = original.clone();
  material.onBeforeCompile = (shader, renderer) => {
    original.onBeforeCompile(shader, renderer);
    shader.uniforms.scFilterAdd = { value: add };
    shader.uniforms.scFilterMultiply = { value: multiply };
    const before = "sourceColor.a *= vScMultiply.a;";
    if (!shader.fragmentShader.includes(before))
      throw new Error("Missing SC color transform in Prince filter material");
    shader.fragmentShader =
      "uniform vec3 scFilterAdd; uniform vec3 scFilterMultiply;\n" +
      shader.fragmentShader.replace(
        before,
        `sourceColor.rgb = clamp(sourceColor.rgb * scFilterMultiply + scFilterAdd, 0.0, 1.0);\n      ${before}`,
      );
  };
  material.customProgramCacheKey = () => "sc1-charge-filter-v1";
  return material;
}

/** The archived Filter clip supplies a color transform for the charged actor. */
export class NativeChargeFilter {
  private actors = new Map<number, FilteredActor>();

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.colors[Math.max(0, actor.frame)],
      applied: !!actor.materials,
    }));
  }

  burst(id: number, time: number, age: number) {
    if (chargeFilterFrame(age) < 0) return;
    const actor = this.actors.get(id);
    if (actor) {
      actor.start = time - age;
      actor.frame = -1;
    } else
      this.actors.set(id, {
        start: time - age,
        frame: -1,
        add: new T.Vector3(),
        multiply: new T.Vector3(1, 1, 1),
      });
  }

  update(
    entities: readonly Entity[],
    time: number,
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const alive = new Set(entities.filter((e) => e.hp > 0).map((e) => e.id));
    for (const [id, actor] of this.actors) {
      const frame = chargeFilterFrame(time - actor.start);
      if (!alive.has(id) || frame < 0) {
        this.release(actor);
        this.actors.delete(id);
        continue;
      }
      const sprite = spriteFor(id);
      if (!sprite) continue;
      if (actor.sprite !== sprite) {
        this.release(actor);
        actor.sprite = sprite;
        actor.materials = (sprite.mesh.material as T.MeshBasicMaterial[]).map(
          (material) => filteredMaterial(material, actor.add, actor.multiply),
        );
        sprite.mesh.material = actor.materials;
      }
      if (frame === actor.frame) continue;
      const [ar, ag, ab, , mr, mg, mb] = source.colors[frame];
      actor.add.set(ar / 255, ag / 255, ab / 255);
      actor.multiply.set(mr / 255, mg / 255, mb / 255);
      actor.frame = frame;
    }
  }

  clear() {
    for (const actor of this.actors.values()) this.release(actor);
    this.actors.clear();
  }

  private release(actor: FilteredActor) {
    if (actor.sprite && actor.materials) {
      actor.sprite.mesh.material = actor.sprite.asset.materials;
      actor.materials.forEach((material) => material.dispose());
    }
    actor.sprite = undefined;
    actor.materials = undefined;
  }
}
