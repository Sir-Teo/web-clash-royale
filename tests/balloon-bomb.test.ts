import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";
import { makeProjectile, updateProjectile } from "../src/render/projectiles";
import { destructionPlan, DestructionEffects } from "../src/render/destruction";
import type { Projectile } from "../src/game/engine";

function library() {
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
  return library;
}

describe("native Balloon death bomb", () => {
  it("plays each team's drop once at its ground anchor, including paused and rebuilt projectiles", () => {
    const art = library(),
      camera = new T.Camera();
    for (const team of ["blue", "red"] as const) {
      const p: Projectile = {
        id: 1,
        team,
        source: 7,
        x: 4,
        y: 12,
        tx: 4,
        ty: 12,
        target: null,
        damage: 240,
        remaining: 0.8,
        duration: 0.8,
        splash: 2.2,
        air: false,
        style: "bomb",
        stun: 0,
        flight: { x: 4, y: 12 },
        elapsed: 0,
        fromHeight: 3.8,
        toHeight: 0.2,
        arc: 0,
      };
      const shot = makeProjectile(p, art);
      expect(shot.sprites.map((s) => s.name)).toEqual([`balloon_bomb_${team}`]);
      const clip = art.asset!.data.clips[`balloon_bomb_${team}`];
      for (const elapsed of [0, 0.2, 0.5, 0.7, 2]) {
        p.elapsed = elapsed;
        p.remaining = Math.max(0, 0.8 - elapsed);
        updateProjectile(shot, p, art, camera);
        expect(shot.object.position.toArray()).toEqual([-5, 0.2, -4]);
        expect(shot.sprites[0].frame).toBe(
          clip.frames[Math.min(30, Math.floor(elapsed * 30))],
        );
        const geometry = shot.sprites[0].mesh.geometry;
        updateProjectile(shot, p, art, camera);
        expect(shot.sprites[0].mesh.geometry).toBe(geometry);
        const rebuilt = makeProjectile(p, art);
        updateProjectile(rebuilt, p, art, camera);
        expect(rebuilt.sprites[0].frame).toBe(shot.sprites[0].frame);
      }
      // An unavailable bundle still renders the existing falling fallback.
      p.elapsed = 0;
      p.remaining = 0.8;
      const fallback = makeProjectile(p, new EffectLibrary());
      updateProjectile(fallback, p, art, camera);
      expect(fallback.sprites).toHaveLength(0);
      expect(fallback.object.position.y).toBe(3.8);
    }
    art.destroy();
  });

  it("retains all six explosion emitters, delayed smoke and a five-second ground mark across both atlases", () => {
    const plan = destructionPlan("balloon-bomb", 91);
    expect(plan).toHaveLength(54);
    expect(destructionPlan("balloon-bomb", 91, "red")).toEqual(plan);
    expect(plan.filter((p) => p.clip === "smoke_cloud_1")).toHaveLength(10);
    expect(
      plan
        .filter((p) => p.clip === "smoke_cloud_1")
        .every((p) => p.delay >= 0.1 && p.delay <= 0.127),
    ).toBe(true);
    const ground = plan.find((p) => p.clip === "bomb_destruction_state")!;
    expect({
      delay: ground.delay,
      life: ground.life,
      ground: ground.ground,
      scale: ground.scale,
    }).toEqual({ delay: 0.1, life: 5, ground: true, scale: 1 });
    expect(ground.emitter.fadeOut).toBe(1);
    const art = library(),
      scene = new T.Scene(),
      camera = new T.Camera();
    const effects = new DestructionEffects(scene, art);
    effects.burst("balloon-bomb", new T.Vector3(), 91);
    effects.update(0, camera);
    expect(effects.activeClips.bomb_destruction_state).toBeUndefined();
    effects.update(0.2, camera);
    expect(effects.activeClips.bomb_destruction_state).toBe(1);
    const matrices = scene.children.map((o) => [
      ...(o as T.InstancedMesh).instanceMatrix.array,
    ]);
    effects.update(0, camera);
    expect(
      scene.children.map((o) => [
        ...(o as T.InstancedMesh).instanceMatrix.array,
      ]),
    ).toEqual(matrices);
    effects.update(3.8, camera);
    expect(effects.activeClips).toEqual({ bomb_destruction_state: 1 });
    effects.update(1.1, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.burst("balloon-bomb", new T.Vector3(), 91, "blue", 4);
    effects.update(0, camera);
    expect(effects.activeClips).toEqual({ bomb_destruction_state: 1 });
    const mesh = scene.children.find((o) => o.visible) as T.InstancedMesh;
    expect(mesh.geometry.groups.map((g) => g.materialIndex)).toEqual([1]);
    effects.clear();
    expect(effects.activeClips).toEqual({});
    art.destroy();
  });
});
