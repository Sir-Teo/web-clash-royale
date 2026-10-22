import { describe, it, expect } from "vitest";
import * as T from "three";
import { readFileSync } from "node:fs";
import { Battle } from "../src/game/engine";
import { destroyedTowerSites } from "../src/game/arena-layout";
import {
  destructionPlan,
  debrisPose,
  DestructionEffects,
} from "../src/render/destruction";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";

describe("native tower destruction", () => {
  it("derives correct ruins from current state, including rebuilt replay states", () => {
    const b = new Battle({ seed: 7, ai: false });
    expect(destroyedTowerSites(b.entities)).toEqual([]);
    const king = b.entities.find((e) => e.king && e.team === "red")!;
    const princess = b.entities.find(
      (e) => e.team === "blue" && e.lane === "left",
    )!;
    king.hp = 0;
    b.entities = b.entities.filter((e) => e.id !== princess.id);
    expect(destroyedTowerSites(b.entities)).toEqual([
      { team: "red", x: 9, y: 2.5, king: true },
      { team: "blue", x: 4, y: 26, king: false, lane: "left" },
    ]);
    expect(destroyedTowerSites(new Battle({ seed: 7 }).entities)).toEqual([]);
  });
  it("preserves source composition counts, delays and seeded variety", () => {
    const a = destructionPlan(false, 42);
    expect(a).toHaveLength(78);
    expect(destructionPlan(true, 42)).toEqual(a);
    expect(destructionPlan(false, 42)).toEqual(a);
    expect(destructionPlan(false, 43)).not.toEqual(a);
    const smoke = a.filter((p) => p.clip === "smoke_cloud_1");
    expect(smoke).toHaveLength(10);
    expect(
      smoke.every((p) => p.delay >= 0.25 && p.life >= 1.1 && p.life <= 2.5),
    ).toBe(true);
    expect(
      new Set(a.filter((p) => p.clip.includes("crate")).map((p) => p.clip))
        .size,
    ).toBe(3);
    for (const p of a)
      for (const age of [0, p.life / 2, p.life]) {
        const pose = debrisPose(p, age);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(pose.y).toBeGreaterThanOrEqual(0.04);
        expect(pose.opacity).toBeGreaterThanOrEqual(0);
        expect(pose.opacity).toBeLessThanOrEqual(1);
      }
  });
  it("freezes paused debris, expires after the win and releases only owned materials", () => {
    const library = new EffectLibrary();
    const data = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    const textures = data.textures.map(() => new T.Texture());
    library.asset = {
      data,
      textures,
      materials: textures.map(makeMaterial),
      geometry: new Map(),
      scale: 1 / 30,
    };
    const scene = new T.Scene(),
      effects = new DestructionEffects(scene, library),
      camera = new T.Camera();
    effects.burst(false, new T.Vector3(), 2);
    expect(effects.count).toBe(78);
    effects.update(0.4, camera);
    const before = scene.children.map((o) => o.position.toArray());
    for (let i = 0; i < 10; i++) effects.update(0, camera);
    expect(scene.children.map((o) => o.position.toArray())).toEqual(before);
    const mesh = scene.children[0] as T.Mesh<
      T.BufferGeometry,
      T.MeshBasicMaterial[]
    >;
    expect(mesh.material[0]).not.toBe(library.asset.materials[0]);
    let disposed = 0;
    mesh.material[0].addEventListener("dispose", () => disposed++);
    effects.update(5, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(disposed).toBe(1);
    effects.burst(true, new T.Vector3(), 4);
    effects.clear();
    expect(effects.count).toBe(0);
    expect(effects.time).toBe(0);
    expect(library.asset.geometry.size).toBeGreaterThan(0);
    library.destroy();
  });
});
