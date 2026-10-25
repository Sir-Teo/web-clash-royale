import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { createMatchFinisher } from "../src/game/match-finisher";

function setup(tick = 5370) {
  const battle = new Battle({ seed: 12, ai: false });
  battle.tick = tick;
  for (const e of battle.entities) e.active = false;
  const tower = (team: "blue" | "red", king = false) =>
    battle.entities.find((e) => e.team === team && !!e.king === king)!;
  const king = tower("red", true),
    enemyKing = tower("blue", true);
  const princess = tower("blue"),
    ownPrincess = tower("red");
  king.hp = 100;
  enemyKing.hp = 300;
  princess.hp = 50;
  battle.players.red.hand = ["rocket", "zap", "pekka", "pekka"];
  battle.players.red.elixir = 6;
  const incoming = (target: Entity, remaining: number): Projectile => ({
    id: 900,
    team: "blue",
    source: 0,
    x: 9,
    y: 30,
    tx: target.x,
    ty: target.y,
    target: null,
    damage: 500,
    remaining,
    duration: remaining,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    towerDamageFraction: 0.4,
  });
  return { battle, king, enemyKing, princess, ownPrincess, incoming };
}
const think = (battle: Battle) =>
  (battle as unknown as { think: () => void }).think();
const step = (battle: Battle, ticks: number) => {
  for (let i = 0; i < ticks && !battle.winner; i++) battle.step();
};
const forecast = (battle: Battle) =>
  createMatchFinisher(
    "red",
    battle.entities,
    battle.projectiles,
    battle.areas,
    { blue: battle.players.blue.crowns, red: battle.players.red.crowns },
    battle.remaining,
    false,
  );

describe("AI regulation finishers", () => {
  it("takes a Princess lead before regulation ends instead of launching a late King Rocket", () => {
    const { battle, enemyKing } = setup();
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 30);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("More crowns");
    expect(battle.time).toBe(180);
    expect(enemyKing.hp).toBeGreaterThan(0);
  });

  it("still prefers a King Rocket that can win before the regulation clock", () => {
    const { battle } = setup(5250);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("rocket");
    step(battle, 150);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("King Tower destroyed");
    expect(battle.time).toBeLessThan(180);
  });

  it("ties the crowns to reach overtime instead of losing at regulation", () => {
    const { battle, ownPrincess } = setup();
    battle.entities = battle.entities.filter((e) => e.id !== ownPrincess.id);
    battle.players.blue.crowns = 1;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 30);
    expect(battle.winner).toBeNull();
    expect(battle.phase).toBe("overtime");
    expect([battle.players.blue.crowns, battle.players.red.crowns]).toEqual([
      1, 1,
    ]);
  });

  it("holds a spell when the current crown lead already wins at the clock", () => {
    const { battle, princess } = setup();
    const removed = battle.entities.find(
      (e) => e.team === "blue" && !e.king && e.id !== princess.id,
    )!;
    battle.entities = battle.entities.filter((e) => e.id !== removed.id);
    battle.players.red.crowns = 1;
    battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 2;
    think(battle);
    expect(battle.actions).toEqual([]);
    step(battle, 30);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("More crowns");
    expect(princess.hp).toBe(50);
  });

  it("does not apply the HP tiebreaker at the regulation deadline", () => {
    const { battle, king, enemyKing, princess } = setup(5394);
    king.hp = 80;
    enemyKing.hp = enemyKing.maxHp;
    princess.hp = 100;
    battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 2;
    expect(forecast(battle).outcomeAt("zap", princess)).toBeUndefined();
    think(battle);
    expect(battle.actions).toEqual([]);
    step(battle, 6);
    expect(battle.winner).toBeNull();
    expect(battle.time).toBe(180);
    expect(princess.hp).toBe(100);
  });

  it("waits for regulation to end after an early Princess kill", () => {
    const { battle, princess } = setup();
    const race = forecast(battle);
    expect(race.outcomeAt("zap", princess)).toEqual({
      winner: "red",
      step: 30,
    });
    expect(battle.play("red", 1, princess.x, princess.y).ok).toBe(true);
    step(battle, 5);
    expect(princess.hp).toBeLessThanOrEqual(0);
    expect(battle.winner).toBeNull();
    step(battle, 25);
    expect(battle.winner).toBe("red");
  });

  it("includes a simultaneous Princess trade at the boundary before deciding overtime", () => {
    const { battle, princess, ownPrincess, incoming } = setup(5395);
    ownPrincess.hp = 50;
    battle.projectiles.push(incoming(ownPrincess, 5 / 30));
    const race = forecast(battle);
    expect(race.baseline).toEqual({ winner: "blue", step: 5 });
    expect(race.outcomeAt("zap", princess)).toBeUndefined();
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 5);
    expect(battle.winner).toBeNull();
    expect(battle.time).toBe(180);
    expect([battle.players.blue.crowns, battle.players.red.crowns]).toEqual([
      1, 1,
    ]);
  });

  it("does not count a Princess lead as survival before a fatal King impact", () => {
    const { battle, king, princess, incoming } = setup();
    battle.projectiles.push(incoming(king, 0.5));
    const race = forecast(battle);
    expect(race.outcomeAt("zap", princess)).toEqual({
      winner: "blue",
      step: 15,
    });
    expect(race.evaluate("zap", princess, 2, 0)).toBeUndefined();
    expect(battle.play("red", 1, princess.x, princess.y).ok).toBe(true);
    step(battle, 30);
    expect(battle.winner).toBe("blue");
    expect(battle.time).toBe(179.5);
  });

  it("can choose a Poison tick that wins just after a tied regulation boundary", () => {
    const { battle, princess } = setup(5385);
    princess.hp = 20;
    battle.players.red.hand = ["rocket", "poison", "pekka", "pekka"];
    expect(forecast(battle).outcomeAt("poison", princess)).toEqual({
      winner: "red",
      step: 30,
    });
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    step(battle, 30);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("Sudden death");
    expect(battle.time).toBe(180.5);
  });
});
