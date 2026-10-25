import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import definitions from "../src/render/destruction-data.json";
import { destructionPlan, DestructionEffects } from "../src/render/destruction";
import { EffectLibrary } from "../src/render/effects";
import { rocketFlightPoint } from "../src/render/projectiles";
import { Battle } from "../src/game/engine";

function flight() {
  const battle = new Battle({ seed: 4, ai: false });
  battle.players.blue.hand[0] = "rocket";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 6).ok).toBe(true);
  return { battle, shot: battle.projectiles[0] };
}

describe("native Rocket flight trail", () => {
  it("retains all source smoke, spark and glow emitters and their artwork", () => {
    expect(definitions.trails.rocket.source).toBe("Rocket_Emitter");
    expect(
      definitions.trails.rocket.components.map((part) => part.emitter),
    ).toEqual([
      "Rocket_Emitter_Smoketrail",
      "Rocket_Emitter_Sparks",
      "Rocket_Emitter_Glow",
      "Rocket_Emitter_Smoketrail",
    ]);
    const plan = destructionPlan("trail:rocket", 42);
    expect(plan).toHaveLength(173);
    expect(destructionPlan("trail:rocket", 42)).toEqual(plan);
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    for (const particle of plan) expect(clips[particle.clip]).toBeDefined();
    expect(clips.fireball_trail3.frames).toHaveLength(146);
  });

  it("attaches each authored emission to the fixed-step projectile flight, including late reconstruction", () => {
    const { battle, shot } = flight();
    const duration =
      Math.hypot(shot.tx - shot.x, shot.ty - shot.y) / shot.speed!;
    const path = (time: number) => rocketFlightPoint(shot, time);
    expect(path(0).toArray()).toEqual([0, 2.4, 14]);
    expect(path(duration).x).toBe(-5);
    expect(path(duration).y).toBeCloseTo(0.2);
    expect(path(duration).z).toBe(-10);
    for (let i = 0; i < 30; i++) battle.step();
    expect(path(shot.elapsed!).x).toBeCloseTo(shot.flight!.x - 9);
    expect(path(shot.elapsed!).z).toBeCloseTo(shot.flight!.y - 16);

    const library = new EffectLibrary();
    const clips = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    ).clips;
    library.asset = { data: { clips } } as typeof library.asset;
    const trail = new DestructionEffects(new T.Scene(), library);
    trail.burstAlong("trail:rocket", path, duration, 0, 42, "blue", 0);
    const particles = (
      trail as unknown as {
        particles: {
          origin: T.Vector3;
          start: number;
          plan: { delay: number };
        }[];
      }
    ).particles;
    expect(particles).toHaveLength(173);
    for (const particle of particles) {
      expect(particle.start).toBeCloseTo(particle.plan.delay);
      expect(
        particle.origin.distanceTo(path(particle.plan.delay)),
      ).toBeLessThan(1e-8);
    }
    trail.advance(0.4);
    const still = trail.time;
    trail.advance(0);
    expect(trail.time).toBe(still);
    trail.clear();
    trail.burstAlong("trail:rocket", path, duration, 0, 42, "blue", 2.4);
    expect(trail.count).toBeGreaterThan(0);
    expect(trail.count).toBeLessThan(173);
  });
});
