import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import { SpriteFilterStack } from "../src/render/sprite-filter";
import { NativeRageFilter, rageFilterFrame } from "../src/render/rage-filter";
import {
  NativeColdFilter,
  NativeColdStructures,
} from "../src/render/cold-filter";
import source from "../src/render/rage-filter-data.json";

describe("native Rage color", () => {
  it("pins the complete 50-frame magenta pulse and source hashes", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/rage-filter-manifest.json", "utf8"),
    );
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source.source).toBe("filter_rage");
    expect(source.fps).toBe(30);
    expect(source.colors).toHaveLength(50);
    expect(source.colors[0]).toEqual([100, 0, 100, 255, 255, 255, 255]);
    expect(rageFilterFrame(0.1)).toBe(3);
    expect(rageFilterFrame(50 / 30)).toBe(0);
  });

  it("composes with Freeze on troops and restores structure materials after each buff ends", () => {
    const originals = [makeMaterial(new T.Texture())];
    const sprite: AnimatedSprite = {
      mesh: new T.Mesh(new T.BufferGeometry(), originals),
      asset: { materials: originals } as SpriteAsset,
      lastFrame: 0,
      facingX: 0,
      facingY: 0,
    };
    const e = {
      id: 8,
      hp: 100,
      kind: "troop",
      stun: 1,
      rage: { remaining: 2 },
    } as Entity;
    const stack = new SpriteFilterStack(),
      rage = new NativeRageFilter(stack),
      cold = new NativeColdFilter(stack);
    rage.update([e], 0, () => sprite);
    cold.update([e], 0, () => sprite);
    expect(stack.state[0].layers).toEqual(["rage", "cold"]);
    const held = sprite.mesh.material;
    rage.update([e], 0.1, () => sprite);
    expect(sprite.mesh.material).toBe(held);
    expect(rage.state[0].frame).toBe(3);
    e.rage = undefined;
    rage.update([e], 0.2, () => sprite);
    expect(stack.state[0].layers).toEqual(["cold"]);
    e.stun = 0;
    cold.update([e], 0.2, () => sprite);
    expect(sprite.mesh.material).toBe(originals);
    const structures = new NativeColdStructures();
    e.kind = "tower";
    e.rage = { remaining: 2 };
    e.stun = 1;
    const parts = [{ mesh: sprite.mesh, originals }];
    structures.update([e], 1, () => parts);
    expect(structures.rageState[0]).toMatchObject({
      id: 8,
      parts: 1,
      frame: 0,
    });
    e.rage = undefined;
    structures.update([e], 1.1, () => parts);
    expect(structures.rageState).toEqual([]);
    expect(structures.state).toHaveLength(1);
    e.stun = 0;
    structures.update([e], 1.2, () => parts);
    expect(sprite.mesh.material).toBe(originals);
    e.rage = { remaining: 2 };
    structures.update([e], 2, () => parts);
    structures.clear();
    expect(sprite.mesh.material).toBe(originals);
    sprite.mesh.geometry.dispose();
    originals.forEach((m) => m.dispose());
  });
});
