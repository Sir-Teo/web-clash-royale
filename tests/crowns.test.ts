import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import { Battle } from "../src/game/engine";
import {
  CrownEffects,
  crownPose,
  CROWN_FLIGHT_SECONDS,
} from "../src/render/crowns";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";

describe("native crown rewards", () => {
  it("reports newly earned crowns, including direct and partial King wins", () => {
    function destroy(b: Battle, king: boolean) {
      const tower = b.entities.find(
        (e) => e.team === "red" && e.kind === "tower" && !!e.king === king,
      )!;
      tower.hp = 1;
      b.players.blue.hand[0] = "zap";
      b.players.blue.elixir = 10;
      expect(b.play("blue", 0, tower.x, tower.y).ok).toBe(true);
      for (let i = 0; i < 10; i++) b.step();
    }
    const direct = new Battle({ seed: 12, ai: false });
    destroy(direct, true);
    expect(
      direct.events.filter((e) => e.type === "crown").map((e) => e.value),
    ).toEqual([3]);
    const partial = new Battle({ seed: 12, ai: false });
    destroy(partial, false);
    destroy(partial, true);
    expect(
      partial.events.filter((e) => e.type === "crown").map((e) => e.value),
    ).toEqual([1, 2]);
    expect(partial.players.blue.crowns).toBe(3);
  });
  it("lands exactly on the counter after lifting from the destroyed tower", () => {
    const origin = { x: 80, y: 200 },
      target = { x: 360, y: 30 };
    expect(crownPose(0, origin, target, 50)).toMatchObject(origin);
    expect(crownPose(0.24, origin, target, 50).y).toBeLessThan(origin.y);
    const landed = crownPose(CROWN_FLIGHT_SECONDS, origin, target, 50);
    expect(landed.x).toBeCloseTo(target.x, 10);
    expect(landed.y).toBeCloseTo(target.y, 10);
    for (const age of [0, 0.1, 0.24, 0.6, 1, CROWN_FLIGHT_SECONDS])
      expect(
        Object.values(crownPose(age, origin, target, 50)).every(
          Number.isFinite,
        ),
      ).toBe(true);
  });
  it("freezes, retargets after resizing, expires and releases only owned materials", () => {
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
      crowns = new CrownEffects(scene, library);
    const camera = new T.OrthographicCamera(-12, 12, 18, -18, 0.1, 100);
    camera.position.z = 20;
    camera.updateMatrixWorld();
    crowns.burst("blue", new T.Vector3(), 3, 0);
    expect(crowns.state).toHaveLength(3);
    let disposed = 0,
      sharedDisposed = 0;
    for (const mesh of scene.children as T.Mesh<
      T.BufferGeometry,
      T.MeshBasicMaterial[]
    >[])
      mesh.material[0].addEventListener("dispose", () => disposed++);
    library.asset.materials[0].addEventListener(
      "dispose",
      () => sharedDisposed++,
    );
    const target = () => ({ x: 370, y: 30 });
    crowns.update(0.5, camera, 390, 700, target);
    const paused = crowns.state;
    for (let i = 0; i < 10; i++) crowns.update(0.5, camera, 390, 700, target);
    expect(crowns.state).toEqual(paused);
    crowns.update(0.5, camera, 844, 180, () => ({ x: 820, y: 30 }));
    expect(crowns.state).not.toEqual(paused);
    for (const c of crowns.state) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(844);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(180);
    }
    crowns.update(2, camera, 390, 700, target);
    expect(crowns.state).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(disposed).toBe(3);
    expect(sharedDisposed).toBe(0);
    expect(library.asset.geometry.size).toBeGreaterThan(0);
    crowns.burst("red", new T.Vector3(), 3, 2, 2);
    expect(crowns.state).toEqual([]);
    crowns.burst("red", new T.Vector3(), 3, 2);
    crowns.clear();
    expect(scene.children).toEqual([]);
    library.destroy();
  });
});
