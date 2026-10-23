import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as T from "three";
import type { Entity } from "../src/game/engine";
import type { AnimatedSprite, SpriteAsset } from "../src/render/sprites";
import { makeMaterial } from "../src/render/sprites";
import {
  NativeChargeFilter,
  chargeFilterColor,
  chargeFilterFrame,
} from "../src/render/charge-filter";
import source from "../src/render/charge-filter-data.json";

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function sprite(): AnimatedSprite {
  const material = makeMaterial(new T.Texture());
  const asset = { materials: [material] } as SpriteAsset;
  return {
    mesh: new T.Mesh(new T.BufferGeometry(), asset.materials),
    asset,
    lastFrame: 0,
    facingX: 0,
    facingY: 0,
  };
}

describe("native Prince charge filter", () => {
  it("retains the pinned 54-frame source colors and input hashes", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/charge-filter-manifest.json", "utf8"),
    );
    for (const input of manifest.inputs)
      expect(sha256(input.path)).toBe(input.sha256);
    expect(sha256(manifest.output.path)).toBe(manifest.output.sha256);
    expect(source.source).toBe("filter_protection");
    expect(source.fps).toBe(60);
    expect(source.colors).toHaveLength(54);
    expect(chargeFilterColor(0)).toEqual([0, 0, 0, 255, 255, 255, 255]);
    expect(chargeFilterColor(26 / 60)).toEqual([
      68, 56, 0, 255, 255, 255, 243,
    ]);
    expect(chargeFilterFrame(-0.01)).toBe(-1);
    expect(chargeFilterColor(54 / 60)).toBeNull();
  });

  it("ages the actor color on the match clock and restores shared sprite materials", () => {
    const filter = new NativeChargeFilter();
    const prince = sprite();
    const original = prince.asset.materials;
    const entities = [{ id: 7, hp: 100 }] as Entity[];
    filter.burst(7, 3, 0.1);
    filter.update(entities, 3, () => prince);
    expect(filter.state).toEqual([
      expect.objectContaining({ id: 7, frame: 6, applied: true }),
    ]);
    expect(prince.mesh.material).not.toBe(original);
    filter.update(entities, 3, () => prince);
    expect(filter.state[0].frame).toBe(6);
    filter.update(entities, 3.4, () => prince);
    expect(filter.state[0]).toMatchObject({ frame: 30, color: source.colors[30] });
    filter.update(entities, 4, () => prince);
    expect(filter.state).toEqual([]);
    expect(prince.mesh.material).toBe(original);
    filter.burst(7, 5, 0);
    filter.update(entities, 5, () => prince);
    filter.clear();
    expect(filter.state).toEqual([]);
    expect(prince.mesh.material).toBe(original);
    filter.burst(7, 6, 1);
    expect(filter.state).toEqual([]);
    prince.mesh.geometry.dispose();
    original.forEach((material) => material.dispose());
  });

  it("keeps simultaneous Princes on independent filter clocks", () => {
    const filter = new NativeChargeFilter();
    const first = sprite();
    const second = {
      ...first,
      mesh: new T.Mesh(new T.BufferGeometry(), first.asset.materials),
    };
    const entities = [
      { id: 1, hp: 100 },
      { id: 2, hp: 100 },
    ] as Entity[];
    const spriteFor = (id: number) => (id === 1 ? first : second);
    filter.burst(1, 0, 0);
    filter.update(entities, 0.2, spriteFor);
    expect(first.mesh.material).not.toBe(first.asset.materials);
    expect(second.mesh.material).toBe(first.asset.materials);
    filter.burst(2, 0.4, 0);
    filter.update(entities, 0.5, spriteFor);
    expect(second.mesh.material).not.toBe(first.asset.materials);
    expect(second.mesh.material).not.toBe(first.mesh.material);
    expect(filter.state.map((actor) => actor.frame)).toEqual([30, 5]);
    filter.update(entities, 1, spriteFor);
    expect(filter.state.map((actor) => actor.id)).toEqual([2]);
    expect(first.mesh.material).toBe(first.asset.materials);
    expect(second.mesh.material).not.toBe(first.asset.materials);
    filter.update([{ id: 2, hp: 0 }] as Entity[], 1.1, spriteFor);
    expect(filter.state).toEqual([]);
    expect(second.mesh.material).toBe(first.asset.materials);
    first.mesh.geometry.dispose();
    second.mesh.geometry.dispose();
    first.asset.materials.forEach((material) => material.dispose());
  });
});
