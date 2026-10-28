import { describe, expect, it } from "vitest";
import { Battle, type Projectile } from "../src/game/engine";
import { createMatchFinisher } from "../src/game/match-finisher";

function setup(tick = 6000) {
  const battle = new Battle({ seed: 12, ai: false });
  battle.tick = tick;
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === "red" && e.king)!;
  const enemyKing = battle.entities.find((e) => e.team === "blue" && e.king)!;
  const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
  king.hp = 100;
  enemyKing.hp = 300;
  princess.hp = 50;
  battle.players.red.hand = ["rocket", "zap", "pekka", "pekka"];
  battle.players.red.elixir = 6;
  const incoming = (
    target: typeof king,
    remaining: number,
    damage = 500,
  ): Projectile => ({
    id: 900,
    team: "blue",
    source: 0,
    x: 9,
    y: 30,
    tx: target.x,
    ty: target.y,
    target: null,
    damage,
    remaining,
    duration: remaining,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    towerDamageFraction: 0.4,
  });
  return { battle, king, enemyKing, princess, incoming };
}
const think = (battle: Battle) =>
  (battle as unknown as { think: () => void }).think();
const finish = (battle: Battle, limit = 300) => {
  for (let i = 0; i < limit && !battle.winner; i++) battle.step();
};
const forecast = (battle: Battle, team: "red" | "blue" = "red") =>
  createMatchFinisher(
    team,
    battle.entities,
    battle.projectiles,
    battle.areas,
    { blue: battle.players.blue.crowns, red: battle.players.red.crowns },
    battle.remaining,
  );

describe("AI overtime finishers", () => {
  it("wins with a Princess Zap before the incoming King shot instead of launching a late King Rocket", () => {
    const { battle, king, incoming } = setup();
    battle.projectiles.push(incoming(king, 0.5));
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("Sudden death");
    expect(king.hp).toBe(100);
    expect(battle.players.red.crowns).toBe(1);
  });

  it("recognizes an incoming Princess loss as the overtime deadline", () => {
    const { battle, incoming } = setup();
    const ownPrincess = battle.entities.find(
      (e) => e.team === "red" && !e.king,
    )!;
    ownPrincess.hp = 50;
    battle.projectiles.push(incoming(ownPrincess, 0.5));
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(ownPrincess.hp).toBe(50);
  });

  it("takes the earliest overtime victory even without incoming damage", () => {
    const { battle } = setup();
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(battle.time).toBeLessThan(201);
  });

  it("keeps the normal King priority during regulation", () => {
    const { battle } = setup(3000);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("rocket");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("King Tower destroyed");
  });

  it("uses chip damage to win the imminent tiebreaker even when no tower is spell-lethal", () => {
    const { battle, king, enemyKing, princess } = setup(8994);
    king.hp = 80;
    enemyKing.hp = enemyKing.maxHp;
    princess.hp = 100;
    battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 2;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("Tiebreaker");
    expect(princess.hp).toBe(23);
  });

  it("treats a simultaneous Princess trade as survival, then continues playing", () => {
    const { battle, princess, incoming } = setup();
    const ownPrincess = battle.entities.find(
      (e) => e.team === "red" && !e.king,
    )!;
    ownPrincess.hp = 50;
    battle.projectiles.push(incoming(ownPrincess, 0.15));
    const race = forecast(battle);
    expect(race.baseline).toEqual({ winner: "blue", step: 5 });
    expect(race.outcomeAt("zap", princess)).toBeUndefined();
    expect(race.evaluate("zap", princess, 2, 0)?.score).toBeGreaterThan(10_000);
    expect(battle.play("red", 1, princess.x, princess.y).ok).toBe(true);
    finish(battle, 10);
    expect(battle.winner).toBeNull();
    expect([battle.players.red.crowns, battle.players.blue.crowns]).toEqual([
      1, 1,
    ]);
  });

  it("resolves an own King loss ahead of a Princess kill on the same step", () => {
    const { battle, king, princess, incoming } = setup();
    battle.projectiles.push(incoming(king, 0.15));
    const race = forecast(battle);
    expect(race.outcomeAt("zap", princess)).toEqual({
      winner: "blue",
      step: 5,
    });
    expect(race.evaluate("zap", princess, 2, 0)).toBeUndefined();
    expect(battle.play("red", 1, princess.x, princess.y).ok).toBe(true);
    finish(battle);
    expect(battle.winner).toBe("blue");
  });

  it("can turn a certain King loss into a simultaneous King draw", () => {
    const { battle, king, enemyKing, incoming } = setup();
    enemyKing.hp = 50;
    battle.projectiles.push(incoming(king, 0.15));
    const race = forecast(battle);
    expect(race.outcomeAt("zap", enemyKing)).toEqual({
      winner: "draw",
      step: 5,
    });
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("draw");
  });

  it("does not count a spell arriving after the tiebreaker", () => {
    const { battle, king, enemyKing, princess } = setup(8997);
    king.hp = 80;
    enemyKing.hp = enemyKing.maxHp;
    princess.hp = 100;
    const race = forecast(battle);
    expect(race.outcomeAt("zap", princess)).toEqual({
      winner: "blue",
      step: 3,
    });
    expect(race.evaluate("zap", princess, 2, 0)).toBeUndefined();
    expect(battle.play("red", 1, princess.x, princess.y).ok).toBe(true);
    finish(battle);
    expect(battle.winner).toBe("blue");
    expect(princess.hp).toBe(100);
  });

  it("accelerates a queued King victory with an earlier Princess hit", () => {
    const { battle, enemyKing, princess, incoming } = setup();
    battle.projectiles.push({ ...incoming(enemyKing, 2, 1000), team: "red" });
    const race = forecast(battle);
    expect(race.baseline).toEqual({ winner: "red", step: 60 });
    expect(race.outcomeAt("zap", princess)).toEqual({ winner: "red", step: 5 });
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.reason).toBe("Sudden death");
    expect(enemyKing.hp).toBe(300);
  });

  it("does not promote chip damage on the basis of a distant final clock", () => {
    const { battle, enemyKing, princess } = setup();
    enemyKing.hp = enemyKing.maxHp;
    princess.hp = 100;
    const race = forecast(battle);
    expect(race.baseline).toBeUndefined();
    expect(race.outcomeAt("zap", princess)).toBeUndefined();
    expect(race.evaluate("zap", princess, 2, 0)).toBeUndefined();
  });

  it("uses actual Mirror cost when two spells end the match on the same step", () => {
    const { battle } = setup();
    battle.players.red.hand = ["zap", "mirror", "pekka", "pekka"];
    battle.players.red.lastPlayed = "zap";
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
  });

  it("forecasts both teams without changing combat state or consuming randomness", () => {
    const { battle, king } = setup();
    king.hp = 50;
    const before = JSON.stringify(battle);
    const race = forecast(battle, "blue");
    expect(race.outcomeAt("zap", king)).toEqual({ winner: "blue", step: 5 });
    expect(race.evaluate("zap", king, 2, 0)?.matchDecisionStep).toBe(5);
    expect(JSON.stringify(battle)).toBe(before);
  });

  it("uses the earlier Poison tick instead of a slow King Rocket", () => {
    const { battle, king, princess, incoming } = setup();
    princess.hp = 20;
    battle.projectiles.push(incoming(king, 1.5));
    battle.players.red.hand = ["rocket", "poison", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("Sudden death");
    expect(king.hp).toBe(100);
  });

  it("holds Poison when the existing cloud already wins sooner", () => {
    const { battle, princess } = setup();
    princess.hp = 20;
    battle.players.red.hand[0] = "poison";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, princess.x, princess.y).ok).toBe(true);
    const original = [...battle.actions];
    battle.players.red.hand = ["poison", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions).toEqual(original);
    finish(battle);
    expect(battle.winner).toBe("red");
  });

  it.each(["king", "princess"] as const)(
    "holds Zap when a queued %s hit already ends overtime earlier",
    (target) => {
      const { battle, enemyKing, princess, incoming } = setup();
      enemyKing.hp = 50;
      const tower = target === "king" ? enemyKing : princess;
      battle.projectiles.push({ ...incoming(tower, 0.05), team: "red" });
      battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = 2;
      think(battle);
      expect(battle.actions).toEqual([]);
      finish(battle);
      expect(battle.winner).toBe("red");
      expect(battle.time).toBeCloseTo(200 + 2 / 30);
    },
  );

  it.each([
    { windup: 0.1, expected: "freeze" },
    { windup: 0.3, expected: "zap" },
  ])(
    "keeps pending King protection when a $windup-second attack precedes the overtime finisher",
    ({ windup, expected }) => {
      const { battle, king } = setup();
      battle.players.blue.hand[0] = "lumberjack";
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 9, 22).ok).toBe(true);
      const attacker = battle.entities.at(-1)!;
      Object.assign(attacker, {
        x: king.x,
        y: king.y + 1.5,
        deploy: 0,
        active: true,
        cooldown: 100,
        target: king.id,
        pendingAttack: {
          target: king.id,
          remaining: windup,
          damage: attacker.damage,
        },
      });
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      battle.players.red.elixir = 4;
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(expected);
      finish(battle, 10);
      expect(king.hp).toBe(100);
      expect(battle.winner).toBe(expected === "zap" ? "red" : null);
    },
  );
});
