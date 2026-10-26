import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { SpriteFilterStack } from "./sprite-filter";
import source from "./deploy-filter-data.json";

const cards = new Set<string>(source.cards);
const legendaryCards = new Set<string>(source.legendary.cards);
const minerCards = new Set<string>(source.miner.cards);
interface FilteredActor {
  sprite: AnimatedSprite;
  frame: number;
  legendary: boolean;
  miner: boolean;
}

export function hasNativeDeployFilter(card: string) {
  return cards.has(card) || legendaryCards.has(card) || minerCards.has(card);
}

export function deployFilterFrame(age: number, legendary = false, miner = false) {
  const timeline = miner ? source.miner : legendary ? source.legendary : source;
  const life = timeline.frames.length / timeline.fps;
  return age >= 0 && age < life
    ? Math.min(timeline.frames.length - 1, Math.floor(age * timeline.fps))
    : -1;
}

/** Archived default and Legendary Base-layer troop deployment filters. */
export class NativeDeployFilter {
  private actors = new Map<number, FilteredActor>();

  constructor(private filters = new SpriteFilterStack()) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      color: (actor.miner ? source.miner : actor.legendary ? source.legendary : source).frames[actor.frame]?.color,
      applied: this.filters.has(id, "deploy"),
    }));
  }

  update(
    entities: readonly Entity[],
    spriteFor: (id: number) => AnimatedSprite | undefined,
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      const legendary = legendaryCards.has(entity.card);
      const miner = minerCards.has(entity.card);
      // Hold the first authored pose until this body's visual offset elapses.
      const visualAge = entity.age < 0 ? entity.age :
        Math.max(0, entity.age - (entity.deployVisualDelay ?? 0));
      const frame = deployFilterFrame(visualAge, legendary, miner);
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
          legendary,
          miner,
        };
        this.actors.set(entity.id, actor);
      }
      const pose = miner ? source.miner.frames[frame] : legendary ? source.legendary.frames[frame] : source.frames[frame];
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
