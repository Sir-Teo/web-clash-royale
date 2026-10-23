import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./bat-wiggle-data.json";

interface WiggleActor {
  sprite: AnimatedSprite;
  frame: number;
}

export function batWiggleFrame(age: number) {
  return Math.floor(Math.max(0, age) * source.fps + 1e-6) % source.frames.length;
}

/** Archived looping matrix and color filter attached to each Bat. */
export class NativeBatWiggle {
  private actors = new Map<number, WiggleActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      applied: this.filters.has(id, "wiggle"),
    }));
  }

  update(
    entities: readonly Entity[],
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.card !== "bats" || entity.hp <= 0) continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      const frame = batWiggleFrame(entity.age);
      const pose = source.frames[frame];
      this.filters.set(entity.id, "wiggle", sprite, pose.color);
      sprite.mesh.scale.x *= pose.matrix[0];
      sprite.mesh.scale.y *= pose.matrix[3];
      sprite.mesh.position.x += pose.matrix[4] * sprite.asset.scale;
      sprite.mesh.position.y -= pose.matrix[5] * sprite.asset.scale;
      this.actors.set(entity.id, { sprite, frame });
    }
    for (const [id] of this.actors)
      if (!active.has(id)) {
        this.filters.remove(id, "wiggle");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "wiggle");
    this.actors.clear();
  }
}
