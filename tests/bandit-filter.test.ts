import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import { NativeBanditFilter, banditFilterFrame } from "../src/render/bandit-filter";
import { SpriteFilterStack } from "../src/render/sprite-filter";
import source from "../src/render/bandit-filter-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("native Bandit dash filter", () => {
  it("pins all 60 archived matrix and color poses", () => {
    const manifest = JSON.parse(readFileSync("reference/client/bandit-filter-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source).toMatchObject({ source: "filter_bandit_charge", fps: 60 });
    expect(source.frames).toHaveLength(60);
    expect(source.frames[0].matrix).toEqual([0.9990234375, 0, 0, 0.9990234375, 0, 0]);
    expect(source.frames[10].color).toEqual([0, 0, 0, 164, 255, 255, 255]);
    expect(banditFilterFrame(10 / 60)).toBe(10);
    expect(banditFilterFrame(1)).toBe(-1);
  });

  it("applies during travel, composes with Rage and clears on landing", () => {
    const originals = [makeMaterial(new T.Texture())];
    const asset = { materials: originals, scale: 0.02 } as SpriteAsset;
    const sprite = { mesh: new T.Mesh(new T.BufferGeometry(), originals),
      asset, lastFrame: 0, facingX: 0, facingY: 0 } as AnimatedSprite;
    const stack = new SpriteFilterStack();
    const filter = new NativeBanditFilter(stack);
    const bandit = { id: 9, card: "bandit", hp: 908,
      dash: { target: 10, elapsed: 10 / 60, remaining: 0.5 } } as Entity;
    filter.update([bandit], () => sprite);
    expect(filter.state).toEqual([{ id: 9, frame: 10, applied: true }]);
    expect(sprite.mesh.scale.y).toBeCloseTo(source.frames[10].matrix[3]);
    expect(sprite.mesh.position.y).toBeCloseTo(-source.frames[10].matrix[5] * 0.02);
    stack.set(9, "rage", sprite, [50, 0, 50, 255, 255, 255, 255]);
    expect(stack.state[0].layers).toEqual(["bandit", "rage"]);
    bandit.dash = undefined;
    filter.update([bandit], () => sprite);
    expect(filter.state).toEqual([]);
    expect(stack.state[0].layers).toEqual(["rage"]);
    stack.remove(9, "rage");
    expect(sprite.mesh.material).toBe(originals);
    filter.clear();
    sprite.mesh.geometry.dispose();
    originals.forEach((material) => material.dispose());
  });
});
