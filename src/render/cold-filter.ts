import * as T from "three";
import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import { filteredSpriteMaterials, SpriteFilterStack } from "./sprite-filter";
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

export interface ColdStructurePart {
  mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  originals: T.MeshBasicMaterial[];
}

interface ColdStructure {
  start: number;
  frame: number;
  add: T.Vector3;
  multiply: T.Vector4;
  parts: (ColdStructurePart & { materials: T.MeshBasicMaterial[] })[];
}

/** Apply the same archived buff to multipart buildings and tower characters. */
export class NativeColdStructures {
  private actors = new Map<number, ColdStructure>();

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      frame: actor.frame,
      parts: actor.parts.length,
      color: source.colors[actor.frame],
    }));
  }

  update(
    entities: readonly Entity[],
    time: number,
    partsFor: (id: number) => readonly ColdStructurePart[],
  ) {
    const active = new Set<number>();
    for (const entity of entities) {
      if (
        entity.hp <= 0 ||
        entity.stun <= 0 ||
        (entity.kind !== "tower" && entity.kind !== "building")
      )
        continue;
      const parts = partsFor(entity.id);
      if (!parts.length) continue;
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      if (
        actor &&
        (actor.parts.length !== parts.length ||
          actor.parts.some((part, i) => part.mesh !== parts[i].mesh))
      ) {
        this.release(actor);
        this.actors.delete(entity.id);
        actor = undefined;
      }
      if (!actor) {
        actor = {
          start: time,
          frame: 0,
          add: new T.Vector3(),
          multiply: new T.Vector4(1, 1, 1, 1),
          parts: [],
        };
        actor.parts = parts.map((part) => {
          const materials = filteredSpriteMaterials(part.originals, actor!);
          part.mesh.material = materials;
          return { ...part, materials };
        });
        this.actors.set(entity.id, actor);
      }
      actor.frame = coldFilterFrame(time - actor.start);
      const [ar, ag, ab, alpha, mr, mg, mb] = source.colors[actor.frame];
      actor.add.set(ar / 255, ag / 255, ab / 255);
      actor.multiply.set(mr / 255, mg / 255, mb / 255, alpha / 255);
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

  private release(actor: ColdStructure) {
    for (const part of actor.parts) {
      if (part.mesh.material === part.materials)
        part.mesh.material = part.originals;
      part.materials.forEach((material) => material.dispose());
    }
  }
}
