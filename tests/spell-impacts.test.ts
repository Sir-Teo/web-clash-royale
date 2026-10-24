import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import definitions from "../src/render/destruction-data.json";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import { arrowOffsets } from "../src/render/arrow-volley";
import {
  debrisPose,
  destructionPlan,
  impactEffect,
} from "../src/render/destruction";

describe("native Zap and Arrows impact compositions", () => {
  it("hits troops at the archived four-tile Arrows edge without extending beyond it", () => {
    const battle = new Battle({ seed: 8, ai: false });
    for (const tower of battle.entities) tower.active = false;
    const targets = [13.3, 14.2].map((x) => {
      battle.players.red.hand[0] = "knight";
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const target = battle.entities.filter((e) => e.team === "red" && e.card === "knight").at(-1)!;
      Object.assign(target, { x, y: 22, deploy: 0, active: false, hp: 10000, maxHp: 10000 });
      return target;
    });
    battle.players.blue.hand[0] = "arrows";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 9, 22).ok).toBe(true);
    for (let i = 0; i < 45; i++) battle.step();
    expect(targets.map((target) => target.hp)).toEqual([
      10000 - CARD_MAP.arrows.damage,
      10000,
    ]);
  });

  it("resolves retained spell and effect bindings through the source tables", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const rows = (name: string) =>
      csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"));
    const cards = JSON.parse(
      readFileSync("public/assets/ui/cards/cards.json", "utf8"),
    ).portraits;
    const spell = (id: string) =>
      rows("spells_other").find((r: any) => r.Name === cards[id].row)!;
    const projectile = rows("projectiles").find(
      (r: any) => r.Name === spell("arrows").CustomFirstProjectile,
    )!;
    const area = rows("area_effect_objects").find(
      (r: any) => r.Name === spell("zap").AreaEffectObject,
    )!;
    expect(definitions.impacts.arrows.source).toBe(projectile.HitEffect);
    expect(definitions.impacts.zap.source).toBe(area.OneShotEffect);
    expect(Number(spell("arrows").MultipleProjectiles)).toBe(15);
    expect(Number(spell("arrows").Radius)).toBe(4000);
    const manifest = JSON.parse(
      readFileSync("reference/client/manifest.json", "utf8"),
    );
    expect(manifest.files.map((f: any) => f.path)).toContain(
      "reference/logic/area_effect_objects.csv",
    );
  });

  it("schedules 34 Zap particles and one native ground mark per arrow", () => {
    expect(impactEffect("zap")).toBe("zap");
    expect(impactEffect("arrows")).toBe("arrows");
    const zap = definitions.impacts.zap;
    expect(zap.components.map((c) => c.emitter)).toEqual([
      "Spell_zap_smoke1",
      "Spell_zap_hitSpot",
      "Spell_zap_hitSpot2",
      "Spell_zap_bolt",
      "Spell_zap_sparks",
      "Spell_zap_Flash",
      "Zap_hit_area",
    ]);
    const plan = destructionPlan("zap", 42);
    expect(plan).toHaveLength(34);
    expect(destructionPlan("zap", 42, "red")).toEqual(plan);
    expect(destructionPlan("zap", 43)).not.toEqual(plan);
    expect(plan.filter((p) => p.clip === "electricity")).toHaveLength(16);
    expect(plan.filter((p) => p.clip === "Smoke_puff_01")).toHaveLength(8);
    expect(plan.filter((p) => p.clip === "Death_blue_sparkle1")).toHaveLength(
      6,
    );
    expect(definitions.emitters.Spell_zap_bolt.clips).toEqual([
      "zap_bolt1",
      "zap_bolt2",
    ]);
    expect(plan.filter((p) => p.ground)).toHaveLength(3);
    expect(plan.every((p) => p.delay >= 0 && p.life > 0)).toBe(true);
    for (const particle of plan)
      for (const t of [0, 0.1, 0.5, particle.life])
        expect(
          Object.values(debrisPose(particle, t)).every(Number.isFinite),
        ).toBe(true);

    expect(definitions.impacts.arrows.components).toHaveLength(1);
    expect(definitions.emitters["Arrows Hit Ground"].clips).toEqual(
      Array.from({ length: 6 }, (_, i) => `Arrow_enemy_ground_anim_${i + 1}`),
    );
    const marks = Array.from(
      { length: 90 },
      (_, i) => destructionPlan("arrows", Math.imul(i, 0x9e3779b9))[0],
    );
    expect(marks.every((p) => p.ground && p.life >= 1.5 && p.life <= 1.9)).toBe(
      true,
    );
    expect(new Set(marks.map((p) => p.clip)).size).toBe(6);
  });

  it("keeps 15 unique arrows over three damage waves in both perspectives", () => {
    const battle = new Battle({ seed: 8, ai: false });
    for (const tower of battle.entities) tower.active = false;
    battle.players.blue.hand[0] = "arrows";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 9, 22).ok).toBe(true);
    const arrows = battle.projectiles.filter((p) => p.style === "arrows");
    expect(arrows).toHaveLength(3);
    const offsets = arrows.flatMap((p) =>
      arrowOffsets(p.id, p.delay !== undefined, p.team),
    );
    expect(offsets).toHaveLength(15);
    expect(new Set(offsets.map((p) => `${p.x},${p.y}`)).size).toBe(15);
    expect(offsets.every((p) => Math.hypot(p.x, p.y) <= 4)).toBe(true);
    expect(arrowOffsets(10, false, "blue")).toHaveLength(15);
    for (let i = 0; i < 45; i++) battle.step();
    const hits = battle.events.filter(
      (e) => e.type === "hit" && e.card === "arrows",
    );
    expect(hits).toHaveLength(3);
    expect(
      hits.map((h) => h.arrowVolley?.projectileId).sort((a, b) => a! - b!),
    ).toEqual(arrows.map((p) => p.id).sort((a, b) => a - b));
    const guest = perspective(snapshot(battle), "red").events.filter(
      (e) => e.type === "hit" && e.card === "arrows",
    );
    for (const [i, hit] of hits.entries()) {
      const rotated = guest[i];
      expect([rotated.x, rotated.y, rotated.team]).toEqual([
        18 - hit.x,
        32 - hit.y,
        "red",
      ]);
      expect(rotated.arrowVolley).toEqual(hit.arrowVolley);
      const hostPoints = arrowOffsets(
        hit.arrowVolley!.projectileId,
        true,
        "blue",
      );
      const guestPoints = arrowOffsets(
        rotated.arrowVolley!.projectileId,
        true,
        "red",
      );
      expect(guestPoints).toEqual(
        hostPoints.map((p) => ({ x: -p.x, y: -p.y })),
      );
    }
    expect(battle.tick * STEP).toBeCloseTo(battle.time);
  });

  it("renders all 15 marks for a version-1 single-flight Arrows replay", () => {
    const legacy = JSON.parse(
      readFileSync("tests/fixtures/legacy-replay.json", "utf8"),
    );
    const battle = new Battle({ replay: legacy.replay });
    battle.step();
    const projectile = battle.projectiles.find((p) => p.style === "arrows")!;
    expect(projectile.delay).toBeUndefined();
    for (let i = 1; i < 45; i++) battle.step();
    const hit = battle.events.find(
      (e) => e.type === "hit" && e.card === "arrows",
    );
    expect(hit?.arrowVolley).toEqual({
      projectileId: projectile.id,
      staggered: false,
    });
    expect(arrowOffsets(projectile.id, false, "blue")).toHaveLength(15);
  });
});
