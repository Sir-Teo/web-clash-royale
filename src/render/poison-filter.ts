import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./poison-filter-data.json";

interface PoisonActor {
  start: number;
  frame: number;
  sprite: AnimatedSprite;
}

export function poisonFilterFrame(age: number) {
  return Math.floor(Math.max(0, age) * source.fps + 1e-6) % source.frames.length;
}

/** Archived Poison buff color and gentle squash/stretch on native troop art. */
export class NativePoisonFilter {
  private actors = new Map<number, PoisonActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.frames[actor.frame].color,
      matrix: source.frames[actor.frame].matrix,
      applied: this.filters.has(id, "poison"),
    }));
  }

  update(
    entities: readonly Entity[],
    time: number,
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.hp <= 0 || !entity.poison || entity.poison.remaining <= 0)
        continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (actor?.sprite !== sprite) {
        actor = { start: time, frame: 0, sprite };
        this.actors.set(entity.id, actor);
      }
      actor.frame = poisonFilterFrame(time - actor.start);
      const frame = source.frames[actor.frame];
      this.filters.set(entity.id, "poison", sprite, frame.color);
      // SpriteLibrary.update restores the base size/facing before each call.
      sprite.mesh.scale.x *= frame.matrix[0];
      sprite.mesh.scale.y *= frame.matrix[3];
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "poison");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "poison");
    this.actors.clear();
  }
}
