import { describe, it, expect } from "vitest";
import * as T from "three";
import { readFileSync } from "node:fs";
import { Battle } from "../src/game/engine";
import { destroyedTowerSites } from "../src/game/arena-layout";
import {
  destructionPlan,
  debrisPose,
  DestructionEffects,
  deathEffect,
} from "../src/render/destruction";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";
import { CARDS } from "../src/game/cards";

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
    const a = destructionPlan("tower", 42);
    expect(a).toHaveLength(78);
    expect(destructionPlan("king", 42)).toEqual(a);
    expect(destructionPlan("tower", 42)).toEqual(a);
    expect(destructionPlan("tower", 43)).not.toEqual(a);
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
  it("preserves card-specific death compositions, shadows and lingering swords", () => {
    for (const card of CARDS)
      expect(!!deathEffect(card.id)).toBe(card.kind !== "spell");
    for (const [id, count] of [
      ["knight", 55],
      ["prince", 54],
      ["giant", 48],
      ["balloon", 28],
      ["skeletons", 16],
      ["goblins", 42],
    ] as const)
      expect(destructionPlan(id, 7)).toHaveLength(count);
    const small = destructionPlan("skeletons", 7);
    expect(small.filter((p) => p.ground)).toHaveLength(7);
    expect(
      small.filter((p) => p.layer === "Shadow").every((p) => p.scale === 0.25),
    ).toBe(true);
    expect(small.find((p) => p.clip.startsWith("death_ground"))!.scale).toBe(
      0.75,
    );
    const sword = destructionPlan("knight", 7).find(
      (p) => p.clip === "particle_sword",
    )!;
    expect(sword.life).toBeGreaterThanOrEqual(24);
    expect(sword.life).toBeLessThanOrEqual(25);
    expect(destructionPlan("giant", 7, "red")).toEqual(
      destructionPlan("giant", 7, "blue"),
    );
  });
  it("retains event timing when several simulation steps precede a render", () => {
    const battle = new Battle({ seed: 7, ai: false });
    battle.entities.find((e) => e.team === "red" && e.lane === "left")!.hp = 1;
    battle.players.blue.hand[0] = "zap";
    battle.play("blue", 0, 4, 6);
    for (let i = 0; i < 30; i++) battle.step();
    const death = battle.events.find((e) => e.type === "death")!;
    expect(death.time).toBeGreaterThan(0);
    expect(death.time).toBeLessThan(battle.time - 0.5);
  });
  it("batches full swarms, freezes instance data and releases owned GPU buffers", () => {
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
    effects.burst("tower", new T.Vector3(), 2);
    expect(effects.count).toBe(78);
    effects.update(0.4, camera);
    const before = scene.children.map((o) => o.position.toArray());
    const instanceBefore = scene.children.map((o) =>
      (o as T.InstancedMesh).instanceMatrix.array.slice(),
    );
    for (let i = 0; i < 10; i++) effects.update(0, camera);
    expect(scene.children.map((o) => o.position.toArray())).toEqual(before);
    expect(
      scene.children.map((o) =>
        (o as T.InstancedMesh).instanceMatrix.array.slice(),
      ),
    ).toEqual(instanceBefore);
    const mesh = scene.children[0] as T.Mesh<
      T.BufferGeometry,
      T.MeshBasicMaterial[]
    >;
    expect(mesh.material[0]).not.toBe(library.asset.materials[0]);
    let disposed = 0,
      geometryDisposed = 0;
    mesh.material[0].addEventListener("dispose", () => disposed++);
    mesh.geometry.addEventListener("dispose", () => geometryDisposed++);
    effects.update(5, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(geometryDisposed).toBe(1);
    expect(disposed).toBe(0);
    effects.burst("king", new T.Vector3(), 4);
    effects.clear();
    expect(effects.count).toBe(0);
    expect(effects.time).toBe(0);
    expect(disposed).toBe(1);
    expect(library.asset.geometry.size).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++)
      effects.burst("skeletons", new T.Vector3(i % 4, 0, Math.floor(i / 4)), i);
    effects.update(0.1, camera);
    expect(effects.count).toBe(960);
    expect(effects.groundCount).toBe(420);
    expect(effects.drawCount).toBeLessThan(40);
    expect(
      scene.children
        .filter((o) => o.visible)
        .reduce((sum, o) => sum + (o as T.InstancedMesh).count, 0),
    ).toBe(960);
    expect(
      [...library.asset.geometry.values()].every(
        (g) => !g.getAttribute("particleOpacity"),
      ),
    ).toBe(true);
    effects.update(5, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.burst("skeletons", new T.Vector3(), 1, "blue", 5);
    expect(effects.count).toBe(0);
    effects.burst("knight", new T.Vector3(), 1, "blue", 5);
    expect(effects.count).toBe(1);
    effects.clear();
    library.destroy();
  });
});
