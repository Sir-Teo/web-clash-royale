import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as T from "three";
import {
  spriteGeometry,
  type SpriteAsset,
  type SpriteData,
} from "../src/render/sprites";
import golden from "./fixtures/sprite-geometry-golden.json";

function asset(data: SpriteData): SpriteAsset {
  return {
    data,
    textures: data.textures.map(() => new T.Texture()),
    materials: [],
    geometry: new Map(),
    scale: 0.027,
  };
}

it.each(golden.files)(
  "preserves every committed expanded triangle and bound in $path",
  (reference) => {
    const source = readFileSync(reference.path);
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      reference.dataSha256,
    );
    const current = asset(JSON.parse(source.toString()));
    const hash = createHash("sha256");
    for (let i = 0; i < reference.frames; i++) {
      const geometry = spriteGeometry(current, i),
        indices = geometry.getIndex()!;
      for (const name of ["position", "uv", "scMultiply", "scAdd"]) {
        const attribute = geometry.getAttribute(name),
          expanded = new Float32Array(indices.count * attribute.itemSize);
        for (let v = 0; v < indices.count; v++)
          for (let c = 0; c < attribute.itemSize; c++)
            expanded[v * attribute.itemSize + c] = attribute.getComponent(
              indices.getX(v),
              c,
            );
        hash.update(name);
        hash.update(Buffer.from(expanded.buffer));
      }
      hash.update(
        JSON.stringify([i, geometry.groups, geometry.boundingSphere]),
      );
      geometry.dispose();
      current.geometry.delete(i);
    }
    expect(hash.digest("hex")).toBe(reference.trianglesSha256);
  },
);

const polygon = (
  points: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 20],
    [0, 20],
  ],
  sheet = 0,
) => ({
  sheet,
  xy: points,
  uv: points.map(([x, y]) => [x / 10, y / 20] as [number, number]),
});
function sample(polygons = [polygon()]): SpriteAsset {
  return asset({
    version: 2,
    textures: [{ file: "test", width: 16, height: 16 }],
    anchor: [0, 0],
    bounds: [0, 0, 10, 20],
    clips: {},
    shapes: { 0: polygons },
    frames: [
      [
        {
          shape: 0,
          matrix: [1, 0, 0, 1, 0, 0],
          color: [0, 0, 0, 255, 255, 255, 255],
        },
      ],
    ],
  });
}

it("stores a quad once in one interleaved vertex buffer and accounts for its indices", () => {
  const source = sample(),
    geometry = spriteGeometry(source, 0);
  expect(geometry.getAttribute("position").count).toBe(4);
  expect(Array.from(geometry.getIndex()!.array)).toEqual([0, 1, 2, 0, 2, 3]);
  const attributes = Object.values(
    geometry.attributes,
  ) as T.InterleavedBufferAttribute[];
  expect(new Set(attributes.map((a) => a.data)).size).toBe(1);
  expect(attributes.map((a) => [a.itemSize, a.offset])).toEqual([
    [3, 0],
    [2, 3],
    [4, 5],
    [3, 9],
  ]);
  expect(geometry.userData.spriteFrameBytes).toBe(204);
  expect(geometry.groups).toEqual([{ start: 0, count: 6, materialIndex: 0 }]);
  expect(spriteGeometry(source, 0)).toBe(geometry);
});

it("retains noncontiguous blend groups in their original triangle order", () => {
  const source = sample();
  source.data.frames[0] = [0, 3, 4, 8, 0].map((blend) => ({
    ...source.data.frames[0][0],
    blend,
  }));
  const geometry = spriteGeometry(source, 0);
  expect(
    geometry.groups.map((g) => [g.start, g.count, g.materialIndex]),
  ).toEqual([
    [0, 6, 0],
    [6, 6, 1],
    [12, 6, 2],
    [18, 6, 3],
    [24, 6, 0],
  ]);
});

it("uses 32-bit indices beyond the fixed primitive-restart boundary", () => {
  const points = Array.from(
    { length: 65536 },
    (_, i) => [Math.cos(i), Math.sin(i)] as [number, number],
  );
  const geometry = spriteGeometry(sample([polygon(points)]), 0);
  expect(geometry.getIndex()!.array).toBeInstanceOf(Uint32Array);
  expect(geometry.getIndex()!.getX(geometry.getIndex()!.count - 1)).toBe(65535);
  expect(geometry.userData.spriteFrameBytes).toBe(
    65536 * 48 + (65536 - 2) * 3 * 4,
  );
});

it("keeps independent cloned buffers for native instanced-particle attributes", () => {
  const geometry = spriteGeometry(sample(), 0),
    clone = geometry.clone();
  clone.setAttribute(
    "particleOpacity",
    new T.InstancedBufferAttribute(new Float32Array([0.5, 1]), 1),
  );
  const position = clone.getAttribute("position");
  position.setX(0, 99);
  expect(geometry.getAttribute("position").getX(0)).toBe(0);
  expect(clone.getAttribute("uv").getX(0)).toBe(0);
  expect(clone.getIndex()).not.toBe(geometry.getIndex());
  expect(
    (clone.getAttribute("scMultiply") as T.InterleavedBufferAttribute).data,
  ).toBe((position as T.InterleavedBufferAttribute).data);
});
