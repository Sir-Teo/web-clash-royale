import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import { NativeBatWiggle, batWiggleFrame } from "../src/render/bat-wiggle";
import { SpriteFilterStack } from "../src/render/sprite-filter";
import source from "../src/render/bat-wiggle-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("native Bat looping filter", () => {
  it("pins all 58 matrix and color poses to the archived export", () => {
    const manifest = JSON.parse(readFileSync("reference/client/bat-wiggle-manifest.json", "utf8"));
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source).toMatchObject({ source: "filter_wiggle", fps: 60 });
    expect(source.frames).toHaveLength(58);
    expect(source.frames[0].matrix).toEqual([0.9990234375, 0, 0, 1, 0, -4]);
    expect(source.frames[0].color).toEqual([17, 8, 0, 255, 255, 255, 255]);
    expect(batWiggleFrame(0)).toBe(0);
    expect(batWiggleFrame(58 / 60)).toBe(0);
  });

  it("loops on the actor clock and composes with another native color filter", () => {
    const originals = [makeMaterial(new T.Texture())];
    const asset = { materials: originals, scale: 0.02 } as SpriteAsset;
    const sprite = {
      mesh: new T.Mesh(new T.BufferGeometry(), originals),
      asset, lastFrame: 0, facingX: 0, facingY: 0,
    } as AnimatedSprite;
    const stack = new SpriteFilterStack();
    const wiggle = new NativeBatWiggle(stack);
    const bat = { id: 7, card: "bats", kind: "troop", hp: 83, age: 0 } as Entity;
    const spriteFor = () => sprite;
    wiggle.update([bat], spriteFor);
    expect(wiggle.state).toEqual([{ id: 7, frame: 0, applied: true }]);
    expect(sprite.mesh.position.y).toBeCloseTo(0.08);
    expect(sprite.mesh.material).not.toBe(originals);
    stack.set(7, "rage", sprite, [50, 0, 50, 255, 255, 255, 255]);
    expect(stack.state[0].layers).toEqual(["wiggle", "rage"]);
    sprite.mesh.position.set(0, 0, 0);
    bat.age = 10 / 60;
    wiggle.update([bat], spriteFor);
    expect(wiggle.state[0].frame).toBe(10);
    expect(sprite.mesh.position.x).toBeCloseTo(-0.015);
    bat.hp = 0;
    wiggle.update([bat], spriteFor);
    expect(wiggle.state).toEqual([]);
    expect(stack.state[0].layers).toEqual(["rage"]);
    stack.remove(7, "rage");
    expect(sprite.mesh.material).toBe(originals);
    wiggle.clear();
    sprite.mesh.geometry.dispose();
    originals.forEach((material) => material.dispose());
  });
});
