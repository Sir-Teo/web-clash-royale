import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import definitions from "../src/render/destruction-data.json";
import {
  debrisPose,
  destructionPlan,
  DestructionEffects,
} from "../src/render/destruction";
import {
  particleTailPose,
  rotatedSpriteHeight,
} from "../src/render/particle-tail";
import { EffectLibrary } from "../src/render/effects";
import { spriteGeometry } from "../src/render/sprites";

function asymmetricLibrary() {
  const library = new EffectLibrary();
  library.asset = {
    data: {
      version: 2,
      textures: [],
      anchor: [0, 0],
      bounds: [-100, -100, 100, 100],
      shapes: {
        0: [
          {
            sheet: 0,
            xy: [
              [0, 0],
              [4, 0],
              [4, -2],
              [0, -2],
            ],
            uv: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
          },
        ],
      },
      clips: { smoke_cloud_1: { frames: [0], fps: 30, source: "test" } },
      frames: [
        [
          {
            shape: 0,
            matrix: [1, 0, 0, 1, 11, -5],
            color: [0, 0, 0, 255, 255, 255, 255],
          },
        ],
        [
          {
            shape: 0,
            matrix: [1, 0, 0, 3, 11, -5],
            color: [0, 0, 0, 255, 255, 255, 255],
          },
        ],
      ],
    },
    textures: [new T.Texture()],
    materials: [],
    geometry: new Map(),
    scale: 1,
  };
  return library;
}

describe("native particle tails", () => {
  it("retains all 19 source delay ranges in milliseconds, with stable integer samples", async () => {
    const { csvGroups } = await import("../scripts/lib/csv.mjs");
    const source = csvGroups(
      readFileSync("reference/client/particle_emitters.csv", "utf8"),
    );
    let withTail = 0;
    for (const [name, emitter] of Object.entries(definitions.emitters)) {
      expect(emitter.tailDelayMs).toEqual([
        Number(source[name][0].ParticleMinTailLength),
        Number(source[name][0].ParticleMaxTailLength),
      ]);
      if (emitter.tailDelayMs[1]) withTail++;
    }
    expect(withTail).toBe(19);
    for (const effect of [
      "tower",
      "knight",
      "giant",
      "skeletons",
      "balloon-bomb",
      "fireball",
      "hit:bomber",
      "hit:baby-dragon",
      "hit:wizard",
    ] as const) {
      const particles = destructionPlan(effect, 42);
      expect(destructionPlan(effect, 42)).toEqual(particles);
      for (const p of particles) {
        const ms = p.tailDelay * 1000;
        expect(ms).toBeCloseTo(Math.round(ms), 10);
        expect(ms).toBeGreaterThanOrEqual(p.emitter.tailDelayMs[0]);
        expect(ms).toBeLessThanOrEqual(p.emitter.tailDelayMs[1]);
        if (p.tailDelay) expect(p.ground).toBe(false);
        else expect(ms).toBe(0);
      }
    }
    expect(destructionPlan("tower", 42).map((p) => p.tailDelay)).not.toEqual(
      destructionPlan("tower", 43).map((p) => p.tailDelay),
    );
  });

  it("uses rendered frame height after child rotation, preserving authored origin", () => {
    const library = asymmetricLibrary(),
      asset = library.asset!;
    const frame = spriteGeometry(asset, 0);
    expect(rotatedSpriteHeight(frame, 0)).toBe(2);
    expect(rotatedSpriteHeight(frame, Math.PI / 2)).toBeCloseTo(4);
    expect(rotatedSpriteHeight(frame, Math.PI / 4)).toBeCloseTo(
      6 / Math.sqrt(2),
    );
    expect(rotatedSpriteHeight(spriteGeometry(asset, 1), 0)).toBe(6);
    const points = frame.getAttribute("position");
    expect([points.getX(0), points.getY(0)]).toEqual([11, 5]);
    const empty = new T.BufferGeometry();
    empty.setAttribute("position", new T.Float32BufferAttribute([], 3));
    expect(rotatedSpriteHeight(empty, 1)).toBe(0);
    empty.dispose();
    library.destroy();
  });

  it("stretches between projected endpoints while ignoring depth and retaining midpoint origin", () => {
    const view = new T.Quaternion().setFromEuler(new T.Euler(-0.7, 0.2, 0.4));
    const origin = new T.Vector3(8, 2, -5);
    const head = new T.Vector3(3, 4, 100).applyQuaternion(view).add(origin);
    const tail = particleTailPose(head, origin, view, 2);
    expect(tail.stretch).toBeCloseTo(3.5);
    expect(tail.angle).toBeCloseTo(Math.atan2(4, 3));
    expect(
      tail.position.distanceTo(head.clone().add(origin).multiplyScalar(0.5)),
    ).toBe(0);
    expect(particleTailPose(origin, origin, view, 2)).toMatchObject({
      angle: 0,
      stretch: 1,
    });
    const empty = particleTailPose(head, origin, view, 0);
    expect(empty).toMatchObject({ angle: 0, stretch: 1 });
    expect(empty.position).toEqual(tail.position);
  });

  it("holds the delayed endpoint at birth, then follows the same stopped and floor-clamped motion", () => {
    const smoke = destructionPlan("tower", 42).find(
      (p) => p.clip === "smoke_cloud_1",
    )!;
    expect(smoke.tailDelay).toBeGreaterThan(0);
    expect(debrisPose(smoke, smoke.tailDelay / 2 - smoke.tailDelay)).toEqual(
      debrisPose(smoke, 0),
    );
    const fire = destructionPlan("fireball", 42).find(
      (p) => p.clip === "particle_coal9",
    )!;
    expect(debrisPose(fire, 4).y).toBe(0.04);
    expect(debrisPose(fire, 4 - fire.tailDelay).y).toBe(0.04);
    const decelerating = destructionPlan("knight", 42).find(
      (p) => p.emitter === definitions.emitters.Death_elixir_burst1,
    )!;
    expect(decelerating.emitter.inertia).toBeGreaterThan(0);
    const head = debrisPose(decelerating, 20),
      delayed = debrisPose(decelerating, 20 - decelerating.tailDelay);
    expect(head.x).toBe(delayed.x);
    expect(head.z).toBe(delayed.z);
  });

  it("uploads the native parent affine times child rotation without adding the two angles", () => {
    const library = asymmetricLibrary(),
      scene = new T.Scene(),
      camera = new T.Camera();
    camera.rotation.set(-0.6, 0.3, 0.2);
    const effects = new DestructionEffects(scene, library);
    const origin = new T.Vector3(3, 2, -8),
      time = 0.7;
    effects.advance(time);
    effects.burst("tower", origin, 42, "blue", time);
    effects.update(0, camera);
    const mesh = scene.children.find((o) => o.visible) as T.InstancedMesh;
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    // Independent point-by-point reference: source child rotation, parent X
    // stretch, parent projected rotation, then billboard and midpoint placement.
    const expected = destructionPlan("tower", 42)
      .filter((p) => p.clip === "smoke_cloud_1")
      .map((p) => {
        const age = time - p.delay,
          h = debrisPose(p, age),
          t = debrisPose(p, age - p.tailDelay);
        const current = new T.Vector3(h.x, h.y, h.z).add(origin);
        const delayed = new T.Vector3(t.x, t.y, t.z).add(origin);
        const mid = current.clone().add(delayed).multiplyScalar(0.5);
        const delta = current
          .clone()
          .sub(delayed)
          .applyQuaternion(camera.quaternion.clone().invert());
        const theta = Math.atan2(delta.y, delta.x);
        const height =
          4 * Math.abs(Math.sin(p.angle)) + 2 * Math.abs(Math.cos(p.angle));
        const stretch = (height + Math.hypot(delta.x, delta.y)) / height;
        return {
          depth: mid.dot(normal),
          point(x: number, y: number) {
            const u =
              (Math.cos(p.angle) * x + Math.sin(p.angle) * y) *
              h.scale *
              stretch;
            const v =
              (-Math.sin(p.angle) * x + Math.cos(p.angle) * y) * h.scale;
            return new T.Vector3(
              Math.cos(theta) * u - Math.sin(theta) * v,
              Math.sin(theta) * u + Math.cos(theta) * v,
              0,
            )
              .applyQuaternion(camera.quaternion)
              .add(mid);
          },
        };
      })
      .sort((a, b) => a.depth - b.depth);
    expect(mesh.count).toBe(expected.length);
    for (const [i, ref] of expected.entries()) {
      const matrix = new T.Matrix4();
      mesh.getMatrixAt(i, matrix);
      for (const [x, y] of [
        [0, 0],
        [11, 5],
        [15, 7],
      ])
        expect(
          new T.Vector3(x, y, 0)
            .applyMatrix4(matrix)
            .distanceTo(ref.point(x, y)),
        ).toBeLessThan(0.00001);
    }
    expect(effects.tailState.active).toBe(10);
    expect(effects.tailState.stretched).toBe(10);
    effects.clear();
    expect(effects.tailState).toEqual({
      active: 0,
      stretched: 0,
      maxStretch: 1,
    });
    library.destroy();
  });

  it("reconstructs the same tails for late events, freezes pause and refreshes rotated views", () => {
    const library = asymmetricLibrary(),
      camera = new T.Camera();
    const scenes = [new T.Scene(), new T.Scene()];
    const [normal, late] = scenes.map(
      (scene) => new DestructionEffects(scene, library),
    );
    normal.burst("tower", new T.Vector3(), 42);
    normal.update(0.7, camera);
    late.burst("tower", new T.Vector3(), 42, "blue", 0.7);
    late.update(0, camera);
    const matrices = (scene: T.Scene) =>
      scene.children
        .filter((o) => o.visible)
        .map((o) => [...(o as T.InstancedMesh).instanceMatrix.array]);
    expect(matrices(scenes[1])).toEqual(matrices(scenes[0]));
    expect(late.tailState).toEqual(normal.tailState);
    const held = matrices(scenes[0]);
    const mesh = scenes[0].children[0] as T.InstancedMesh;
    const version = mesh.instanceMatrix.version;
    normal.update(0, camera);
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(matrices(scenes[0])).toEqual(held);
    camera.rotation.x = -0.9;
    normal.update(0, camera);
    expect(matrices(scenes[0])).not.toEqual(held);
    expect(normal.time).toBe(0.7);
    normal.update(5, camera);
    expect(normal.tailState.active).toBe(0);
    expect(scenes[0].children).toHaveLength(0);
    normal.clear();
    late.clear();
    library.destroy();
  });
});
