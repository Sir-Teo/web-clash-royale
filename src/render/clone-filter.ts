import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./clone-filter-data.json";

interface CloneActor {
  sprite: AnimatedSprite;
  frame: number;
  phase: "deploy" | "character";
}

export function cloneFilterPose(age: number) {
  const frame = Math.max(0, Math.floor(age * source.fps + 1e-6));
  return frame < source.deploy.length
    ? { phase: "deploy" as const, frame, color: source.deploy[frame] }
    : {
        phase: "character" as const,
        frame: (frame - source.deploy.length) % source.character.length,
        color:
          source.character[
            (frame - source.deploy.length) % source.character.length
          ],
      };
}

/** Native 41-frame Clone arrival, then its looping 60-frame hologram tint. */
export class NativeCloneFilter {
  private actors = new Map<number, CloneActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      phase: actor.phase,
      applied: this.filters.has(id, "clone"),
    }));
  }

  update(
    entities: readonly Entity[],
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.hp <= 0 || !entity.clone) continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      const pose = cloneFilterPose(entity.age);
      this.filters.set(entity.id, "clone", sprite, pose.color);
      this.actors.set(entity.id, {
        sprite,
        frame: pose.frame,
        phase: pose.phase,
      });
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "clone");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "clone");
    this.actors.clear();
  }
}
