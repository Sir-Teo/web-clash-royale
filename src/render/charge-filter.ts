import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./charge-filter-data.json";

const life = source.colors.length / source.fps;
interface FilteredActor {
  start: number;
  frame: number;
  sprite?: AnimatedSprite;
}

export function chargeFilterFrame(age: number) {
  return age >= 0 && age < life
    ? Math.min(source.colors.length - 1, Math.floor(age * source.fps))
    : -1;
}

/** The archived Filter clip supplies a color transform for the charged actor. */
export class NativeChargeFilter {
  private actors = new Map<number, FilteredActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: source.colors[Math.max(0, actor.frame)],
      applied: this.filters.has(id, "charge"),
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
        this.filters.remove(id, "charge");
        this.actors.delete(id);
        continue;
      }
      const sprite = spriteFor(id);
      if (!sprite) continue;
      this.filters.set(id, "charge", sprite, source.colors[frame]);
      actor.sprite = sprite;
      actor.frame = frame;
    }
  }

  clear() {
    for (const id of this.actors.keys()) this.filters.remove(id, "charge");
    this.actors.clear();
  }
}
