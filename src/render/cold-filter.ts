import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./cold-filter-data.json";

interface ColdActor {
  start: number;
  frame: number;
  sprite: AnimatedSprite;
}

export function coldFilterFrame(age: number) {
  return (
    Math.floor(Math.max(0, age) * source.fps + 1e-6) % source.colors.length
  );
}

/** Freeze and Zap share the archived filter_cold color timeline. */
export class NativeColdFilter {
  private actors = new Map<number, ColdActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.colors[actor.frame],
      applied: this.filters.has(id, "cold"),
    }));
  }

  update(
    entities: readonly Entity[],
    time: number,
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.hp <= 0 || entity.stun <= 0) continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (actor?.sprite !== sprite) {
        actor = { start: time, frame: 0, sprite };
        this.actors.set(entity.id, actor);
      }
      actor.frame = coldFilterFrame(time - actor.start);
      this.filters.set(entity.id, "cold", sprite, source.colors[actor.frame]);
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "cold");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "cold");
    this.actors.clear();
  }
}
