import { readFileSync } from "node:fs";
import * as T from "three";
import { describe, expect, it, vi } from "vitest";
import {
  SpriteLibrary,
  spriteGeometry,
  type SpriteAsset,
  type SpriteData,
} from "../src/render/sprites";

function asset(id: string): SpriteAsset {
  const data = JSON.parse(
    readFileSync(`public/assets/animations/${id}.json`, "utf8"),
  ) as SpriteData;
  const textures = data.textures.map(() => new T.Texture());
  return {
    data,
    textures,
    materials: textures.map((map) => new T.MeshBasicMaterial({ map })),
    geometry: new Map(),
    scale: 0.027,
  };
}
const bytes = (geometry: T.BufferGeometry) =>
  [
    ...new Set(
      Object.values(geometry.attributes).map((attribute) =>
        attribute instanceof T.InterleavedBufferAttribute
          ? attribute.data.array
          : attribute.array,
      ),
    ),
  ].reduce(
    (sum, array) => sum + array.byteLength,
    geometry.getIndex()?.array.byteLength ?? 0,
  );
const contents = (geometry: T.BufferGeometry) => ({
  indices: Array.from(geometry.getIndex()?.array ?? []),
  attributes: Object.fromEntries(
    Object.entries(geometry.attributes).map(([name, attribute]) => [
      name,
      Array.from(attribute.array),
    ]),
  ),
  groups: structuredClone(geometry.groups),
  sphere: geometry.boundingSphere?.clone(),
});

describe("inactive native sprite frame cache", () => {
  it("releases cold frames across assets while retaining recently reused geometry and shared artwork", () => {
    const library = new SpriteLibrary(),
      knight = asset("knight"),
      dragon = asset("inferno-dragon");
    library.assets.set("knight", knight);
    library.assets.set("inferno-dragon", dragon);
    const recent = spriteGeometry(knight, 0),
      cold = spriteGeometry(knight, 1),
      other = spriteGeometry(dragon, 0);
    const releases = [recent, cold, other].map((geometry) =>
      vi.spyOn(geometry, "dispose"),
    );
    const textureRelease = vi.spyOn(knight.textures[0], "dispose");
    const materialRelease = vi.spyOn(knight.materials[0], "dispose");
    expect(spriteGeometry(knight, 0)).toBe(recent);
    const budget = bytes(recent) + bytes(other);
    expect(library.geometryCacheState).toEqual({
      frames: 3,
      bytes: budget + bytes(cold),
    });
    expect(library.trimGeometryCache(budget)).toEqual({
      releasedFrames: 1,
      releasedBytes: bytes(cold),
    });
    expect(library.geometryCacheState).toEqual({ frames: 2, bytes: budget });
    expect(knight.geometry.get(0)).toBe(recent);
    expect(knight.geometry.has(1)).toBe(false);
    expect(dragon.geometry.get(0)).toBe(other);
    expect(releases.map((spy) => spy.mock.calls.length)).toEqual([0, 1, 0]);
    expect(textureRelease).not.toHaveBeenCalled();
    expect(materialRelease).not.toHaveBeenCalled();
    expect(library.trimGeometryCache(budget)).toEqual({
      releasedFrames: 0,
      releasedBytes: 0,
    });
    library.destroy();
    expect(releases.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(textureRelease).toHaveBeenCalledOnce();
    expect(materialRelease).toHaveBeenCalledOnce();
  });

  it("recreates identical source vertices, UVs, colors, draw groups and bounds after eviction", () => {
    const library = new SpriteLibrary(),
      dragon = asset("inferno-dragon");
    library.assets.set("inferno-dragon", dragon);
    const clip = dragon.data.clips["blue-attack-1"];
    const frame = clip.frames[Math.floor(clip.frames.length / 2)];
    const raw = JSON.stringify(dragon.data.frames[frame]);
    const original = spriteGeometry(dragon, frame),
      expected = contents(original);
    const texture = dragon.textures[0],
      material = dragon.materials[0];
    library.trimGeometryCache(0);
    expect(library.geometryCacheState).toEqual({ frames: 0, bytes: 0 });
    const rebuilt = spriteGeometry(dragon, frame);
    expect(rebuilt).not.toBe(original);
    expect(contents(rebuilt)).toEqual(expected);
    expect(JSON.stringify(dragon.data.frames[frame])).toBe(raw);
    expect(dragon.textures[0]).toBe(texture);
    expect(dragon.materials[0]).toBe(material);
    library.destroy();
  });
});
