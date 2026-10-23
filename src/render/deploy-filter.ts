import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./deploy-filter-data.json";

const cards = new Set<string>(source.cards);
const life = source.frames.length / source.fps;
interface FilteredActor {
  sprite: AnimatedSprite;
  frame: number;
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

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.frames[actor.frame]?.color,
      applied: this.filters.has(id, "deploy"),
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
        entity.clone ||
        !hasNativeDeployFilter(entity.card) ||
        frame < 0
      )
        continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (actor?.sprite !== sprite) {
        actor = {
          sprite,
          frame: -1,
        };
        this.actors.set(entity.id, actor);
      }
      const pose = source.frames[frame];
      this.filters.set(entity.id, "deploy", sprite, pose.color);
      actor.frame = frame;
      // SpriteLibrary.update establishes the base pose on every render.
      // The SC matrix uses Y-down pixels; local sprite Y is reflected upward.
      sprite.mesh.scale.x *= pose.matrix[0];
      sprite.mesh.scale.y *= pose.matrix[3];
      sprite.mesh.position.y -= pose.matrix[5] * sprite.asset.scale;
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "deploy");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "deploy");
    this.actors.clear();
  }
}
