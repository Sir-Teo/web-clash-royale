import { describe, expect, it } from "vitest";
import { Battle, type Projectile } from "../src/game/engine";
import { launchedKingDeadline } from "../src/game/king-damage";

function setup() {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === "red" && e.king)!;
  king.hp = 100;
  const predict = () =>
    launchedKingDeadline(
      "red",
      battle.entities,
      battle.projectiles,
      battle.areas,
    );
  const actual = () => {
    const start = battle.tick;
    for (let i = 0; i < 360 && king.hp > 0; i++) battle.step();
    return king.hp <= 0 ? battle.tick - start : Infinity;
  };
  return { battle, king, predict, actual };
}

describe("already launched Crown Tower damage", () => {
  it.each([0, 20])(
    "projects a real Log's launch/rolling contact after %s steps",
    (elapsed) => {
      const { battle, predict, actual } = setup();
      battle.players.blue.hand[0] = "log";
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 9, 18).ok).toBe(true);
      for (let i = 0; i < elapsed; i++) battle.step();
      const step = predict();
      expect(Number.isFinite(step)).toBe(true);
      expect(actual()).toBe(step);
    },
  );

  it("ignores a rolling Log whose lane misses the King", () => {
    const { battle, predict, actual } = setup();
    battle.players.blue.hand[0] = "log";
    battle.players.blue.elixir = 10;
    expect(battle.play("blue", 0, 4, 18).ok).toBe(true);
    expect(predict()).toBe(Infinity);
    expect(actual()).toBe(Infinity);
  });

  it.each(["outward", "returning"] as const)(
    "counts the Executioner's return after an %s snapshot",
    (phase) => {
      const { battle, king, predict, actual } = setup();
      (
        battle as unknown as {
          spawn: (id: string, team: string, x: number, y: number) => void;
        }
      ).spawn("executioner", "blue", king.x, king.y + 5.5);
      const attacker = battle.entities.at(-1)!;
      king.hp = attacker.damage * 1.5;
      Object.assign(attacker, {
        deploy: 0,
        cooldown: 100,
        active: true,
        target: king.id,
        pendingAttack: {
          target: king.id,
          damage: attacker.damage,
          remaining: 0.2,
        },
      });
      let projectile: Projectile | undefined;
      for (let i = 0; i < 100; i++) {
        battle.step();
        projectile = battle.projectiles.find((p) => p.style === "executioner");
        if (
          projectile &&
          (phase === "outward"
            ? projectile.rollHits?.includes(king.id)
            : projectile.returning)
        )
          break;
      }
      expect(projectile).toBeDefined();
      expect(king.hp).toBe(attacker.damage * 0.5);
      const before = structuredClone(battle.projectiles);
      const step = predict();
      expect(battle.projectiles).toEqual(before);
      expect(Number.isFinite(step)).toBe(true);
      expect(actual()).toBe(step);
    },
  );

  it.each([1, 2])(
    "reserves one Poison clock across %s overlapping clouds",
    (count) => {
      const { battle, predict, actual } = setup();
      battle.players.blue.elixir = 10;
      for (let i = 0; i < count; i++) {
        battle.players.blue.hand[0] = "poison";
        expect(battle.play("blue", 0, 9, 2.5).ok).toBe(true);
      }
      const before = structuredClone({
        areas: battle.areas,
        entities: battle.entities,
      });
      expect(predict()).toBe(90);
      expect({ areas: battle.areas, entities: battle.entities }).toEqual(
        before,
      );
      expect(actual()).toBe(90);
    },
  );

  it("retains a lingering Poison tick after the cloud disappears", () => {
    const { battle, king, predict, actual } = setup();
    king.hp = 40;
    king.poison = { remaining: 0.8, elapsed: 0.5 };
    expect(predict()).toBe(15);
    expect(actual()).toBe(15);
  });

  it("does not invent a tick after an expiring Poison buff", () => {
    const { king, predict, actual } = setup();
    king.hp = 40;
    king.poison = { remaining: 0.1, elapsed: 0.1 };
    expect(predict()).toBe(Infinity);
    expect(actual()).toBe(Infinity);
  });

  it("orders a Poison shield packet before a projectile on the same step", () => {
    const { battle, king, predict, actual } = setup();
    king.shield = king.maxShield = 10;
    king.poison = { remaining: 0.8, elapsed: 0.9 };
    battle.projectiles.push({
      id: 900,
      team: "blue",
      source: 0,
      x: 9,
      y: 30,
      tx: king.x,
      ty: king.y,
      target: null,
      damage: 500,
      splash: 2,
      air: true,
      remaining: 0.1,
      duration: 0.1,
      style: "rocket",
      stun: 0,
      towerDamageFraction: 0.4,
    });
    expect(predict()).toBe(3);
    expect(actual()).toBe(3);
  });
});
