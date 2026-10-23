import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import { SpriteFilterStack } from "../src/render/sprite-filter";
import { NativeDeployFilter } from "../src/render/deploy-filter";
import { NativeChargeFilter } from "../src/render/charge-filter";
import {
  NativeColdFilter,
  NativeColdStructures,
  coldFilterFrame,
} from "../src/render/cold-filter";
import source from "../src/render/cold-filter-data.json";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function sprite(): AnimatedSprite {
  const materials = [makeMaterial(new T.Texture())];
  const asset = { materials, scale: 0.02 } as SpriteAsset;
  return {
    mesh: new T.Mesh(new T.BufferGeometry(), materials),
    asset,
    lastFrame: 0,
    facingX: 0,
    facingY: 0,
  };
}

describe("native cold character filter", () => {
  it("pins Freeze and Zap to all 29 archived color frames", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/cold-filter-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source.source).toBe("filter_cold");
    expect(source.fps).toBe(60);
    expect(source.colors).toHaveLength(29);
    expect(source.colors[0]).toEqual([0, 53, 163, 255, 255, 255, 255]);
    expect(source.colors[28]).toEqual([17, 8, 163, 255, 255, 255, 255]);
    expect(coldFilterFrame(0.1)).toBe(6);
    expect(coldFilterFrame(29 / 60)).toBe(0);
  });

  it("composes icy tint with deployment and Prince charge, preserving each remaining layer", () => {
    const stack = new SpriteFilterStack();
    const deploy = new NativeDeployFilter(stack);
    const charge = new NativeChargeFilter(stack);
    const cold = new NativeColdFilter(stack);
    const prince = sprite();
    const original = prince.asset.materials;
    const entity = {
      id: 7,
      card: "prince",
      kind: "troop",
      hp: 100,
      age: 0,
      stun: 0.5,
    } as Entity;
    const sprites = () => prince;
    deploy.update([entity], sprites);
    charge.burst(7, 0, 0);
    charge.update([entity], 0, sprites);
    cold.update([entity], 0, sprites);
    expect(stack.state[0].layers).toEqual(["deploy", "charge", "cold"]);
    expect(prince.mesh.material).not.toBe(original);
    expect(cold.state).toEqual([
      expect.objectContaining({ id: 7, frame: 0, applied: true }),
    ]);
    const sharedMaterial = prince.mesh.material;
    cold.update([entity], 0.1, sprites);
    expect(prince.mesh.material).toBe(sharedMaterial);
    expect(cold.state[0].frame).toBe(6);
    expect(stack.state[0].add[2]).toBeGreaterThan(0.6);
    entity.stun = 0;
    cold.update([entity], 0.2, sprites);
    expect(stack.state[0].layers).toEqual(["deploy", "charge"]);
    expect(prince.mesh.material).not.toBe(original);
    entity.stun = 0.5;
    cold.update([entity], 0.3, sprites);
    expect(cold.state[0].frame).toBe(0);
    entity.age = 0.5;
    deploy.update([entity], sprites);
    expect(stack.state[0].layers).toEqual(["charge", "cold"]);
    charge.update([entity], 1, sprites);
    expect(stack.state[0].layers).toEqual(["cold"]);
    expect(prince.mesh.material).not.toBe(original);
    entity.stun = 0;
    cold.update([entity], 1, sprites);
    expect(stack.state).toEqual([]);
    expect(prince.mesh.material).toBe(original);
    prince.mesh.geometry.dispose();
    original.forEach((material) => material.dispose());
  });

  it("tints every native tower layer and restores their shared materials", () => {
    const cold = new NativeColdStructures();
    const base = sprite();
    const front = new T.Mesh(new T.BufferGeometry(), base.asset.materials);
    const princess = sprite();
    const parts = [
      { mesh: base.mesh, originals: base.asset.materials },
      { mesh: front, originals: base.asset.materials },
      { mesh: princess.mesh, originals: princess.asset.materials },
    ];
    const tower = { id: 3, kind: "tower", hp: 100, stun: 1 } as Entity;
    cold.update([tower], 1, () => parts);
    expect(cold.state).toEqual([
      expect.objectContaining({ id: 3, frame: 0, parts: 3 }),
    ]);
    for (const part of parts)
      expect(part.mesh.material).not.toBe(part.originals);
    const material = base.mesh.material;
    cold.update([tower], 1.1, () => parts);
    expect(cold.state[0].frame).toBe(6);
    expect(base.mesh.material).toBe(material);
    tower.stun = 0;
    cold.update([tower], 1.2, () => parts);
    expect(cold.state).toEqual([]);
    for (const part of parts) expect(part.mesh.material).toBe(part.originals);
    tower.stun = 1;
    cold.update([tower], 2, () => parts);
    cold.clear();
    for (const part of parts) expect(part.mesh.material).toBe(part.originals);
    base.mesh.geometry.dispose();
    front.geometry.dispose();
    princess.mesh.geometry.dispose();
    base.asset.materials.forEach((material) => material.dispose());
    princess.asset.materials.forEach((material) => material.dispose());
  });
});
