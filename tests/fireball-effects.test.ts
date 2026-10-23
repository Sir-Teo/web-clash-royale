import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import definitions from "../src/render/destruction-data.json";
import {
  destructionPlan,
  debrisPose,
  DestructionEffects,
  impactEffect,
  deathEffect,
} from "../src/render/destruction";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";
import { Battle } from "../src/game/engine";
import { snapshot, perspective } from "../src/network/perspective";

describe("native Fireball explosion", () => {
  it("follows the retained card-to-spell-to-projectile impact binding", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const rows = (path: string) => csvRows(readFileSync(path, "utf8"));
    const card = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits.fireball;
    expect(card.table).toBe("spells_other");
    const spell = rows(`reference/logic/${card.table}.csv`).find(
      (r: any) => r.Name === card.row,
    )!;
    expect(spell.Projectile).toBe("FireballSpell");
    const projectile = rows("reference/logic/projectiles.csv").find(
      (r: any) => r.Name === spell.Projectile,
    )!;
    expect(definitions.impacts.fireball.source).toBe(projectile.HitEffect);
    const manifest = JSON.parse(
      readFileSync("reference/client/manifest.json", "utf8"),
    );
    expect(manifest.files).toHaveLength(9);
    expect(manifest.files.map((f: any) => f.path)).toContain(
      "public/assets/ui/cards/cards.json",
    );
  });

  it("retains all ten components, source weighting, delayed fragments and continuous fire", () => {
    expect(impactEffect("fireball")).toBe("fireball");
    expect(impactEffect("knight")).toBeUndefined();
    expect(deathEffect("fireball")).toBeUndefined();
    const source = definitions.impacts.fireball;
    expect(source.source).toBe("Fireball_explosion");
    expect(source.components).toHaveLength(10);
    const plan = destructionPlan("fireball", 42);
    expect(plan).toHaveLength(148);
    expect(destructionPlan("fireball", 42, "red")).toEqual(plan);
    expect(destructionPlan("fireball", 43)).not.toEqual(plan);
    const base = plan.filter(
      (p) => p.emitter === definitions.emitters.explosion_base,
    );
    expect(base).toHaveLength(32);
    expect(
      base.every(
        (p) =>
          p.ground && p.scale === 0.85 && p.delay >= 0.1 && p.delay <= 0.132,
      ),
    ).toBe(true);
    const sparks = definitions.emitters.Fireball_explosion_sparks;
    expect(sparks.clips).toEqual([
      "SparkleBlue",
      "SparkleBlue",
      "SparkleBlue",
      "particle_coal4",
      "particle_coal3",
      "particle_coal2",
    ]);
    const flames = plan.filter((p) => p.clip === "MolotovTrailParticle");
    expect(flames).toHaveLength(8);
    expect(flames[0].delay).toBe(0.3);
    for (let i = 1; i < flames.length; i++) {
      const interval = flames[i].delay - flames[i - 1].delay;
      expect(interval).toBeGreaterThanOrEqual(0.1);
      expect(interval).toBeLessThanOrEqual(0.15);
    }
    const scorch = plan.find((p) => p.clip === "darken_gradient")!;
    expect(scorch.delay).toBe(0.01);
    expect(scorch.life).toBeGreaterThanOrEqual(4);
    expect(scorch.life).toBeLessThanOrEqual(5);
    for (const particle of plan)
      for (const t of [0, 0.016, 0.3, 1, particle.life])
        expect(
          Object.values(debrisPose(particle, t)).every(Number.isFinite),
        ).toBe(true);
  });

  it("matches the retained native linear-speed and current-age gravity integration", () => {
    const probe = JSON.parse(
      readFileSync(
        "reference/client/particle-physics-static-probe.json",
        "utf8",
      ),
    );
    expect(probe.target.sha256).toBe(
      "a7eb74c5b72770e39b8dc2c55e452fc11434f3df3efc46fd0ea13d28c1da9309",
    );
    expect(probe.target.executed).toBe(false);
    expect(probe.getters.Inertia).toBe("0x1f8dd6");
    const plan = destructionPlan("fireball", 52);
    const smoke = plan.find(
      (p) => p.emitter === definitions.emitters.Fireball_explosion_smoke,
    )!;
    expect(smoke.emitter.inertia).toBeCloseTo(20 / 30);
    // Independent literal native stepping in source units, then the existing
    // browser /30 scale. This catches percentage/exponential drag and G/2 errors.
    const initialSpeed = Math.hypot(smoke.vx, smoke.vz) * 30;
    let speed = initialSpeed,
      distance = 0,
      height = 14;
    for (let i = 1; i <= 125; i++) {
      speed = Math.max(0, speed - 20 * 0.016);
      distance += speed * 0.016;
      height += 0.016 * (smoke.vy * 30 + 0.5 * 10 * (i * 0.016));
    }
    const atTwo = debrisPose(smoke, 2);
    expect(atTwo.x - smoke.x).toBeCloseTo(
      ((smoke.vx / (initialSpeed / 30)) * distance) / 30,
      10,
    );
    expect(atTwo.z - smoke.z).toBeCloseTo(
      ((smoke.vz / (initialSpeed / 30)) * distance) / 30,
      10,
    );
    expect(atTwo.y).toBeCloseTo(height / 30, 10);
    expect(debrisPose(smoke, 8).x).toBe(atTwo.x); // stopped horizontally
    for (const axis of ["x", "y", "z"] as const)
      expect(debrisPose(smoke, 2.001)[axis]).toBe(
        debrisPose(smoke, 2.002)[axis],
      );
    const spark = plan.find(
      (p) => p.emitter === definitions.emitters.Fireball_explosion_sparks,
    )!;
    expect(spark.emitter.inertia).toBe(0);
    // Continuous limit for the variable-frame branch, without render history.
    expect(debrisPose(spark, 0.4).y).toBeCloseTo(
      (73 + spark.vy * 30 * 0.4 - 500 * 0.4 ** 2) / 30,
    );
  });

  it("preserves the actual spell hit through peer projection without consuming battle RNG", () => {
    const battle = new Battle({ seed: 31, ai: false });
    battle.players.blue.hand[0] = "fireball";
    battle.play("blue", 0, 4, 12);
    while (
      !battle.events.some((e) => e.type === "hit" && e.card === "fireball")
    )
      battle.step();
    const before = JSON.stringify(snapshot(battle));
    const event = battle.events.find(
      (e) => e.type === "hit" && e.card === "fireball",
    )!;
    const guest = perspective(snapshot(battle), "red");
    const rotated = guest.events.find((e) => e.id === event.id)!;
    expect(rotated).toMatchObject({
      type: "hit",
      card: "fireball",
      x: 14,
      y: 20,
      team: "red",
      time: event.time,
    });
    destructionPlan(
      impactEffect(rotated.card!)!,
      battle.seed ^ event.id,
      "red",
    );
    expect(JSON.stringify(snapshot(battle))).toBe(before);
  });

  it("renders both impacts in bounded batches, holds pause and reconstructs late scorch marks", () => {
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
      camera = new T.Camera();
    const effects = new DestructionEffects(scene, library);
    effects.burst("fireball", new T.Vector3(), 42);
    effects.burst("fireball", new T.Vector3(4, 0, 0), 23, "red");
    effects.update(0.2, camera);
    expect(effects.count).toBe(296);
    expect(effects.activeClips.darken_gradient).toBe(2);
    expect(effects.activeClips.explosion_cloud_1).toBe(92);
    expect(effects.drawCount).toBeLessThan(130);
    const matrices = () =>
      scene.children.map((o) => [
        ...(o as T.InstancedMesh).instanceMatrix.array,
      ]);
    const held = matrices();
    effects.update(0, camera);
    expect(matrices()).toEqual(held);
    effects.update(0.4, camera);
    expect(effects.activeClips.MolotovTrailParticle).toBeGreaterThan(0);
    effects.update(5, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.burst("fireball", new T.Vector3(), 42, "blue", 3.5);
    effects.update(0, camera);
    expect(effects.activeClips).toEqual({ darken_gradient: 1 });
    effects.clear();
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    library.destroy();
  });
});
