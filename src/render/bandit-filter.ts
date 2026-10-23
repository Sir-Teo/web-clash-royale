import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./bandit-filter-data.json";

interface FilteredActor {
  sprite: AnimatedSprite;
  frame: number;
}

export function banditFilterFrame(age: number) {
  return age >= 0 && age < source.frames.length / source.fps
    ? Math.min(source.frames.length - 1, Math.floor(age * source.fps + 1e-6))
    : -1;
}

/** Original 60-FPS matrix and color transform attached during Bandit's dash. */
export class NativeBanditFilter {
  private actors = new Map<number, FilteredActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      applied: this.filters.has(id, "bandit"),
    }));
  }

  update(
    entities: readonly Entity[],
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (entity.card !== "bandit" || entity.hp <= 0 || !entity.dash) continue;
      const frame = banditFilterFrame(entity.dash.elapsed);
      if (frame < 0) continue;
      const sprite = spriteFor(entity.id);
      if (!sprite) continue;
      active.add(entity.id);
      const pose = source.frames[frame];
      this.filters.set(entity.id, "bandit", sprite, pose.color);
      sprite.mesh.scale.x *= pose.matrix[0];
      sprite.mesh.scale.y *= pose.matrix[3];
      sprite.mesh.position.x += pose.matrix[4] * sprite.asset.scale;
      sprite.mesh.position.y -= pose.matrix[5] * sprite.asset.scale;
      this.actors.set(entity.id, { sprite, frame });
    }
    for (const id of this.actors.keys())
      if (!active.has(id)) {
        this.filters.remove(id, "bandit");
        this.actors.delete(id);
      }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "bandit");
    this.actors.clear();
  }
}
