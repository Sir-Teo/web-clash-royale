import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import definitions from "../src/render/destruction-data.json";
import profiles from "../src/game/combat-data.json";
import {
  deathEffect,
  debrisPose,
  destructionPlan,
  impactEffect,
} from "../src/render/destruction";

const attacks = {
  musketeer: ["cannon_hit", 11],
  bomber: ["BombTower_projectile_hit", 97],
  "baby-dragon": ["dragon_hit", 36],
  wizard: ["chr_wizard_projectile_hit", 59],
  cannon: ["cannon_hit", 11],
} as const;

describe("native projectile hit compositions", () => {
  it("binds five card projectiles to their retained hit effects", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const rows = (name: string) =>
      Object.fromEntries(
        csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
          .filter((r: any) => r.Name)
          .map((r: any) => [r.Name, r]),
      );
    const characters = rows("characters");
    const buildings = rows("buildings");
    const projectiles = rows("projectiles");
    for (const [card, [source]] of Object.entries(attacks)) {
      const actor =
        characters[profiles[card as keyof typeof attacks].source] ??
        buildings[profiles[card as keyof typeof attacks].source];
      expect(projectiles[actor.Projectile].HitEffect).toBe(source);
      expect(
        definitions.impacts[`hit:${card}` as keyof typeof definitions.impacts]
          .source,
      ).toBe(source);
      expect(impactEffect(card)).toBe(`hit:${card}`);
    }
    expect(impactEffect("giant")).toBeUndefined();
    expect(impactEffect("balloon")).toBeUndefined();
    expect(impactEffect("tesla")).toBeUndefined();
  });

  it("keeps death and hit compositions distinct while preserving source particle counts", () => {
    for (const [card, [, count]] of Object.entries(attacks)) {
      const key = impactEffect(card)!;
      expect(deathEffect(card)).toBe(card);
      expect(destructionPlan(key, 42)).toHaveLength(count);
      expect(destructionPlan(key, 42, "red")).toEqual(destructionPlan(key, 42));
      expect(destructionPlan(deathEffect(card)!, 42)).not.toEqual(
        destructionPlan(key, 42),
      );
      for (const particle of destructionPlan(key, 42))
        for (const age of [0, 0.1, particle.life])
          expect(
            Object.values(debrisPose(particle, age)).every(Number.isFinite),
          ).toBe(true);
    }
    expect(definitions.impacts["hit:musketeer"]).toEqual(
      definitions.impacts["hit:cannon"],
    );
    expect(definitions.impacts["hit:bomber"].components).toHaveLength(5);
    expect(definitions.impacts["hit:baby-dragon"].components).toHaveLength(3);
    expect(definitions.impacts["hit:wizard"].components).toHaveLength(3);
  });
});
