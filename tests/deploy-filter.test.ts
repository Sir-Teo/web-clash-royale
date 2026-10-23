import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import {
  NativeDeployFilter,
  deployFilterFrame,
  hasNativeDeployFilter,
} from "../src/render/deploy-filter";
import source from "../src/render/deploy-filter-data.json";

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

describe("native troop deployment filter", () => {
  it("pins the source matrix/color sequence and all 33 curated troop bindings", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/deploy-filter-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source.source).toBe("filter_deploy_unit_default");
    expect(source.fps).toBe(60);
    expect(source.frames).toHaveLength(28);
    expect(source.cards).toHaveLength(33);
    expect(hasNativeDeployFilter("knight")).toBe(true);
    expect(hasNativeDeployFilter("prince")).toBe(true);
    expect(hasNativeDeployFilter("cannon")).toBe(false);
    expect(source.frames[0]).toEqual({
      matrix: [0.875, 0, 0, 1.3212890625, 0, -65],
      color: [150, 150, 150, 102, 255, 255, 255],
    });
    expect(deployFilterFrame(-0.01)).toBe(-1);
    expect(deployFilterFrame(28 / 60)).toBe(-1);
  });

  it("applies the source pose and releases its actor-local material after 28 frames", () => {
    const filter = new NativeDeployFilter();
    const knight = sprite();
    const original = knight.asset.materials;
    const e = {
      id: 12,
      card: "knight",
      kind: "troop",
      hp: 100,
      age: 0,
    } as Entity;
    filter.update([e], () => knight);
    expect(filter.state).toEqual([
      expect.objectContaining({ id: 12, frame: 0, applied: true }),
    ]);
    expect(knight.mesh.material).not.toBe(original);
    expect(knight.mesh.scale.x).toBeCloseTo(0.875);
    expect(knight.mesh.scale.y).toBeCloseTo(1.3212890625);
    expect(knight.mesh.position.y).toBeCloseTo(1.3);
    e.age = 20 / 60;
    knight.mesh.scale.set(1, 1, 1);
    knight.mesh.position.y = 0;
    filter.update([e], () => knight);
    expect(filter.state[0].frame).toBe(20);
    expect(knight.mesh.scale.x).toBeCloseTo(source.frames[20].matrix[0]);
    expect(knight.mesh.position.y).toBe(0);
    e.age = 0.5;
    filter.update([e], () => knight);
    expect(filter.state).toEqual([]);
    expect(knight.mesh.material).toBe(original);
    e.age = 0;
    filter.update([e], () => knight);
    filter.clear();
    expect(knight.mesh.material).toBe(original);
    knight.mesh.geometry.dispose();
    original.forEach((material) => material.dispose());
  });

  it("keeps overlapping troop spawns on independent material clocks", () => {
    const filter = new NativeDeployFilter();
    const first = sprite();
    const second = {
      ...first,
      mesh: new T.Mesh(new T.BufferGeometry(), first.asset.materials),
    };
    const firstEntity = {
      id: 1,
      card: "knight",
      kind: "troop",
      hp: 100,
      age: 0,
    } as Entity;
    const secondEntity = { ...firstEntity, id: 2, age: 20 / 60 };
    const spriteFor = (id: number) => (id === 1 ? first : second);
    filter.update([firstEntity, secondEntity], spriteFor);
    expect(filter.state.map((actor) => actor.frame)).toEqual([0, 20]);
    expect(first.mesh.material).not.toBe(second.mesh.material);
    expect(first.mesh.material).not.toBe(first.asset.materials);
    expect(second.mesh.material).not.toBe(first.asset.materials);
    firstEntity.age = 0.5;
    secondEntity.age = 21 / 60;
    second.mesh.scale.set(1, 1, 1);
    second.mesh.position.y = 0;
    filter.update([firstEntity, secondEntity], spriteFor);
    expect(first.mesh.material).toBe(first.asset.materials);
    expect(second.mesh.material).not.toBe(first.asset.materials);
    expect(filter.state.map((actor) => actor.id)).toEqual([2]);
    filter.clear();
    expect(second.mesh.material).toBe(first.asset.materials);
    first.mesh.geometry.dispose();
    second.mesh.geometry.dispose();
    first.asset.materials.forEach((material) => material.dispose());
  });
});
