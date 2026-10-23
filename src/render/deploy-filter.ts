import * as T from "three";
import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { filteredSpriteMaterials } from "./sprite-filter";
import source from "./deploy-filter-data.json";

const cards = new Set<string>(source.cards);
const life = source.frames.length / source.fps;
interface FilteredActor {
  sprite: AnimatedSprite;
  frame: number;
  materials: T.MeshBasicMaterial[];
  add: T.Vector3;
  multiply: T.Vector4;
}

export function hasNativeDeployFilter(card: string) {
  return cards.has(card);
}

export function deployFilterFrame(age: number) {
  return age >= 0 && age < life
    ? Math.min(source.frames.length - 1, Math.floor(age * source.fps))
    : -1;
}

/** Source Base-layer deployment filter for the 19 curated troop families. */
export class NativeDeployFilter {
  private actors = new Map<number, FilteredActor>();

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.frames[actor.frame]?.color,
      applied: true,
    }));
  }

  update(
    entities: readonly Entity[],
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      const frame = deployFilterFrame(entity.age);
      if (
        entity.kind !== "troop" ||
        entity.hp <= 0 ||
        !hasNativeDeployFilter(entity.card) ||
        frame < 0
      )
        continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (actor?.sprite !== sprite) {
        if (actor) this.release(actor);
        actor = {
          sprite,
          frame: -1,
          materials: [],
          add: new T.Vector3(),
          multiply: new T.Vector4(1, 1, 1, 1),
        };
        actor.materials = filteredSpriteMaterials(
          sprite.mesh.material as T.MeshBasicMaterial[],
          actor,
        );
        sprite.mesh.material = actor.materials;
        this.actors.set(entity.id, actor);
      }
      const pose = source.frames[frame];
      if (frame !== actor.frame) {
        const [ar, ag, ab, alpha, mr, mg, mb] = pose.color;
        actor.add.set(ar / 255, ag / 255, ab / 255);
        actor.multiply.set(mr / 255, mg / 255, mb / 255, alpha / 255);
        actor.frame = frame;
      }
      // SpriteLibrary.update establishes the base pose on every render.
      // The SC matrix uses Y-down pixels; local sprite Y is reflected upward.
      sprite.mesh.scale.x *= pose.matrix[0];
      sprite.mesh.scale.y *= pose.matrix[3];
      sprite.mesh.position.y -= pose.matrix[5] * sprite.asset.scale;
    }
    for (const [id, actor] of this.actors)
      if (!active.has(id)) {
        this.release(actor);
        this.actors.delete(id);
      }
  }

  clear() {
    for (const actor of this.actors.values()) this.release(actor);
    this.actors.clear();
  }

  private release(actor: FilteredActor) {
    actor.sprite.mesh.material = actor.sprite.asset.materials;
    actor.materials.forEach((material) => material.dispose());
  }
}
