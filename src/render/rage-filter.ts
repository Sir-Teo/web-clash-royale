import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./rage-filter-data.json";

interface RageActor {
  start: number;
  frame: number;
  sprite: AnimatedSprite;
}

export function rageFilterFrame(age: number) {
  return (
    Math.floor(Math.max(0, age) * source.fps + 1e-6) % source.colors.length
  );
}

/** Archived Rage color timeline on friendly troop artwork. */
export class NativeRageFilter {
  private actors = new Map<number, RageActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.colors[actor.frame],
      applied: this.filters.has(id, "rage"),
    }));
  }

  update(
    entities: readonly Entity[],
    time: number,
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.hp <= 0 || !entity.rage?.remaining) continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (actor?.sprite !== sprite) {
        actor = { start: time, frame: 0, sprite };
        this.actors.set(entity.id, actor);
      }
      actor.frame = rageFilterFrame(time - actor.start);
      this.filters.set(entity.id, "rage", sprite, source.colors[actor.frame]);
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "rage");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "rage");
    this.actors.clear();
  }
}
