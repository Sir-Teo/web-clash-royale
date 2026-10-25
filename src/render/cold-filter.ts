import * as T from "three";
import type { Entity } from "../game/engine";
import type { AnimatedSprite } from "./sprites";
import {
  composeFilterColors,
  filteredSpriteMaterials,
  SpriteFilterStack,
} from "./sprite-filter";
import source from "./cold-filter-data.json";
import rageSource from "./rage-filter-data.json";
import { rageFilterFrame } from "./rage-filter";
import poisonSource from "./poison-filter-data.json";
import { poisonFilterFrame } from "./poison-filter";

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

/** Freeze, Zap, and Ice Wizard's slow share the archived filter_cold timeline. */
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
      if (entity.hp <= 0 || (entity.stun <= 0 && !entity.slow?.remaining)) continue;
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
  rage?: { start: number; frame: number };
  cold?: { start: number; frame: number };
  poison?: { start: number; frame: number };
  add: T.Vector3;
  multiply: T.Vector4;
  parts: (ColdStructurePart & { materials: T.MeshBasicMaterial[] })[];
}

/** Compose archived buff colors across all native building and tower parts. */
export class NativeColdStructures {
  private actors = new Map<number, ColdStructure>();

  get state() {
    return [...this.actors.entries()]
      .filter(([, actor]) => actor.cold)
      .map(([id, actor]) => ({
        id,
        frame: actor.cold!.frame,
        parts: actor.parts.length,
        color: source.colors[actor.cold!.frame],
      }));
  }

  get poisonState() {
    return [...this.actors.entries()]
      .filter(([, actor]) => actor.poison)
      .map(([id, actor]) => ({
        id,
        frame: actor.poison!.frame,
        parts: actor.parts.length,
        color: poisonSource.frames[actor.poison!.frame].color,
      }));
  }

  get rageState() {
    return [...this.actors.entries()]
      .filter(([, actor]) => actor.rage)
      .map(([id, actor]) => ({
        id,
        frame: actor.rage!.frame,
        parts: actor.parts.length,
        color: rageSource.colors[actor.rage!.frame],
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
        (entity.stun <= 0 &&
          !entity.slow?.remaining &&
          !entity.poison?.remaining &&
          !entity.rage?.remaining) ||
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
      if (entity.stun > 0 || entity.slow?.remaining) {
        actor.cold ??= { start: time, frame: 0 };
        actor.cold.frame = coldFilterFrame(time - actor.cold.start);
      } else actor.cold = undefined;
      if (entity.poison?.remaining) {
        actor.poison ??= { start: time, frame: 0 };
        actor.poison.frame = poisonFilterFrame(time - actor.poison.start);
      } else actor.poison = undefined;
      if (entity.rage?.remaining) {
        actor.rage ??= { start: time, frame: 0 };
        actor.rage.frame = rageFilterFrame(time - actor.rage.start);
      } else actor.rage = undefined;
      const colors = [
        ...(actor.rage ? [rageSource.colors[actor.rage.frame]] : []),
        ...(actor.poison
          ? [poisonSource.frames[actor.poison.frame].color]
          : []),
        ...(actor.cold ? [source.colors[actor.cold.frame]] : []),
      ];
      const color = composeFilterColors(colors);
      actor.add.set(...color.add);
      actor.multiply.set(...color.multiply);
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
