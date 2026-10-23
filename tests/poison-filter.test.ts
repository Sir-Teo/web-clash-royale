import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import { SpriteFilterStack } from "../src/render/sprite-filter";
import { NativeColdFilter } from "../src/render/cold-filter";
import { NativeColdStructures } from "../src/render/cold-filter";
import { NativePoisonFilter, poisonFilterFrame } from "../src/render/poison-filter";
import source from "../src/render/poison-filter-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("native Poison filter", () => {
  it("retains all 37 archived color and squash frames", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/poison-filter-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source.source).toBe("filter_poison");
    expect(source.fps).toBe(60);
    expect(source.frames).toHaveLength(37);
    expect(source.frames[0].color).toEqual([0, 60, 0, 255, 255, 255, 255]);
    expect(source.frames[0].matrix[3]).toBeGreaterThan(1);
    expect(poisonFilterFrame(0.1)).toBe(6);
    expect(poisonFilterFrame(37 / 60)).toBe(0);
  });

  it("composes Poison and Freeze colors and restores shared materials", () => {
    const originals = [makeMaterial(new T.Texture())];
    const sprite = {
      mesh: new T.Mesh(new T.BufferGeometry(), originals),
      asset: { materials: originals } as SpriteAsset,
      lastFrame: 0,
      facingX: 0,
      facingY: 0,
    } satisfies AnimatedSprite;
    const entity = {
      id: 8,
      hp: 100,
      stun: 0.5,
      poison: { remaining: 0.75, elapsed: 0.25 },
    } as Entity;
    const stack = new SpriteFilterStack();
    const cold = new NativeColdFilter(stack);
    const poison = new NativePoisonFilter(stack);
    cold.update([entity], 0, () => sprite);
    poison.update([entity], 0, () => sprite);
    expect(stack.state[0].layers).toEqual(["poison", "cold"]);
    expect(sprite.mesh.scale.y).toBeCloseTo(source.frames[0].matrix[3]);
    const filtered = sprite.mesh.material;
    sprite.mesh.scale.set(1, 1, 1); // Native sprite update before the next render.
    cold.update([entity], 0.1, () => sprite);
    poison.update([entity], 0.1, () => sprite);
    expect(poison.state[0].frame).toBe(6);
    expect(sprite.mesh.material).toBe(filtered);
    expect(sprite.mesh.scale.x).toBeCloseTo(source.frames[6].matrix[0]);
    expect(stack.state[0].add[1]).toBeGreaterThan(0.1);
    entity.poison = undefined;
    poison.update([entity], 0.2, () => sprite);
    expect(stack.state[0].layers).toEqual(["cold"]);
    entity.stun = 0;
    cold.update([entity], 0.2, () => sprite);
    expect(stack.state).toEqual([]);
    expect(sprite.mesh.material).toBe(originals);
    sprite.mesh.geometry.dispose();
    originals.forEach((material) => material.dispose());
  });

  it("tints every native tower part and composes overlapping Freeze", () => {
    const originals = [makeMaterial(new T.Texture())];
    const parts = Array.from({ length: 3 }, () => ({
      mesh: new T.Mesh(new T.BufferGeometry(), originals),
      originals,
    }));
    const tower = {
      id: 4,
      kind: "tower",
      hp: 100,
      stun: 0,
      poison: { remaining: 1, elapsed: 0.2 },
    } as Entity;
    const filters = new NativeColdStructures();
    filters.update([tower], 0, () => parts);
    expect(filters.poisonState).toEqual([
      expect.objectContaining({ id: 4, frame: 0, parts: 3 }),
    ]);
    expect(filters.state).toEqual([]);
    for (const part of parts) expect(part.mesh.material).not.toBe(originals);
    const material = parts[0].mesh.material;
    tower.stun = 1;
    filters.update([tower], 0.1, () => parts);
    expect(filters.poisonState[0].frame).toBe(6);
    expect(filters.state[0].frame).toBe(0);
    expect(parts[0].mesh.material).toBe(material);
    tower.poison = undefined;
    filters.update([tower], 0.2, () => parts);
    expect(filters.poisonState).toEqual([]);
    expect(filters.state).toHaveLength(1);
    tower.stun = 0;
    filters.update([tower], 0.3, () => parts);
    for (const part of parts) expect(part.mesh.material).toBe(originals);
    filters.update([{ ...tower, poison: { remaining: 1, elapsed: 0 } }], 1, () => parts);
    filters.clear();
    for (const part of parts) {
      expect(part.mesh.material).toBe(originals);
      part.mesh.geometry.dispose();
    }
    originals.forEach((material) => material.dispose());
  });
});
