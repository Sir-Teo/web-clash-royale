import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import {
  effectMaterials,
  spriteGeometry,
  type SpriteAsset,
} from "../src/render/sprites";

describe("native effect blending", () => {
  it("retains source additive glow, screen lightning and multiply projectile children", async () => {
    const { parseSC } = await import("../scripts/lib/sc.mjs");
    const source = parseSC(readFileSync("reference/sc/effects.bin"));
    const data = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    const blends = (name: string) =>
      new Set(
        data.clips[name].frames.flatMap((frame: number) =>
          data.frames[frame].map((p: any) => p.blend ?? 0),
        ),
      );
    expect(source.clips[source.names.SparkleBlue].children[0].blend).toBe(8);
    expect(blends("SparkleBlue")).toEqual(new Set([8]));
    expect(blends("FireParticle1")).toEqual(new Set([8]));
    expect(blends("particle_coal9")).toEqual(new Set([0, 8]));
    expect(blends("zap_bolt1")).toEqual(new Set([4]));
    expect(blends("fireball_small")).toEqual(new Set([0, 3, 8]));
    expect(blends("darken_gradient")).toEqual(new Set([0]));
  });

  it("assigns independent blend materials on both texture atlases with correct soft-edge factors", () => {
    const textures = [new T.Texture(), new T.Texture()];
    const materials = effectMaterials(textures);
    expect(materials).toHaveLength(8);
    expect(materials.map((m) => m.map)).toEqual([
      ...textures,
      ...textures,
      ...textures,
      ...textures,
    ]);
    expect(
      materials.slice(0, 2).every((m) => m.blending === T.NormalBlending),
    ).toBe(true);
    const multiply = materials[2],
      screen = materials[4],
      additive = materials[6];
    expect(multiply.premultipliedAlpha).toBe(true);
    expect([multiply.blendSrc, multiply.blendDst]).toEqual([
      T.DstColorFactor,
      T.OneMinusSrcAlphaFactor,
    ]);
    expect(screen.premultipliedAlpha).toBe(true);
    expect([screen.blendSrc, screen.blendDst]).toEqual([
      T.OneFactor,
      T.OneMinusSrcColorFactor,
    ]);
    expect(additive.blending).toBe(T.AdditiveBlending);
    expect(materials.every((m) => !m.depthWrite && !m.toneMapped)).toBe(true);
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  });

  it("keeps display-list order across normal and additive parts without losing their source texture", () => {
    const data = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    const textures = data.textures.map(() => new T.Texture());
    const asset: SpriteAsset = {
      data,
      textures,
      materials: effectMaterials(textures),
      geometry: new Map(),
      scale: 1 / 30,
    };
    const clip = data.clips.particle_coal9;
    const frame = clip.frames.find(
      (i: number) =>
        data.frames[i].some((p: any) => p.blend === 8) &&
        data.frames[i].some((p: any) => !p.blend),
    );
    const geometry = spriteGeometry(asset, frame);
    expect(new Set(geometry.groups.map((g) => g.materialIndex))).toEqual(
      new Set([0, data.textures.length * 3]),
    );
    let drawCount = 0;
    for (const group of geometry.groups) {
      expect(group.start).toBe(drawCount);
      expect(asset.materials[group.materialIndex!]).toBeDefined();
      drawCount += group.count;
    }
    expect(drawCount).toBe(geometry.getIndex()!.count);
    expect(drawCount).toBeGreaterThan(geometry.getAttribute("position").count);
    expect(spriteGeometry(asset, frame)).toBe(geometry);
    asset.geometry.forEach((g) => g.dispose());
    asset.materials.forEach((m) => m.dispose());
    textures.forEach((t: T.Texture) => t.dispose());
  });
});
