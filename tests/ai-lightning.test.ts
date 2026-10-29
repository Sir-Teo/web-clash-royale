import { describe, expect, it } from "vitest";
import {
  Battle,
  type AreaEffect,
  type Entity,
  type Point,
  type Projectile,
  type Team,
} from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { damageSpellTarget } from "../src/game/spell-targeting";
import {
  createLightningPlan,
  selectLightningTarget,
} from "../src/game/lightning-strikes";
import {
  launchedKingDeadline,
  createKingSpellRace,
} from "../src/game/king-damage";

const lightningStrikes = (
  team: Team,
  point: Point,
  entities: readonly Entity[],
  area?: AreaEffect,
  projectiles: readonly Projectile[] = [],
  areas: readonly AreaEffect[] = [],
) => {
  const plan = createLightningPlan(team, entities, area, projectiles, areas);
  return plan(point, area?.radius);
};

function setup(tick = 0) {
  const battle = new Battle({ seed: 12, ai: false });
  battle.tick = tick;
  for (const e of battle.entities) e.active = false;
  battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
  battle.players.red.elixir = 6;
  const spawn = (card: CardId, x: number, y: number) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: string, x: number, y: number) => void;
      }
    ).spawn(card, "blue", x, y);
    const e = battle.entities.at(-1)!;
    Object.assign(e, { deploy: 0, active: false, speed: 0 });
    return e;
  };
  const target = () =>
    damageSpellTarget(
      "lightning",
      "red",
      battle.entities,
      battle.projectiles,
      battle.areas,
    );
  const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
  const ownKing = battle.entities.find((e) => e.team === "red" && e.king)!;
  const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
  return { battle, spawn, target, king, ownKing, princess };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, ticks = 60) => {
  for (let i = 0; i < ticks && !b.winner; i++) b.step();
};

describe("AI Lightning targeting", () => {
  it("finishes a weak Princess without waiting for a troop threat", () => {
    const { battle, princess } = setup();
    princess.hp = 400;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("lightning");
    step(battle);
    expect(princess.hp).toBe(0);
    expect(battle.players.red.crowns).toBe(1);
  });

  it("spends its three distinct strikes on a valuable deployed group", () => {
    const { battle, spawn } = setup();
    const group = [
      spawn("wizard", 4, 9),
      spawn("witch", 6, 9),
      spawn("musketeer", 5, 11),
    ];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("lightning");
    step(battle);
    expect(group.every((e) => e.hp === 0)).toBe(true);
    expect(
      battle.events.filter((e) => e.type === "hit" && e.card === "lightning"),
    ).toHaveLength(3);
  });

  it("does not spend six elixir on a cheap swarm", () => {
    const { battle, spawn, target } = setup();
    spawn("skeleton-army", 4, 9);
    expect(target()).toBeUndefined();
    think(battle);
    expect(battle.actions).toEqual([]);
  });

  it("does not claim a fourth target as a tower finisher", () => {
    const { battle, spawn, king, target } = setup();
    king.hp = 50;
    for (let i = 0; i < 3; i++) spawn("giant", king.x, king.y);
    expect(target()?.lethalTower).not.toBe(king.id);
    expect(
      lightningStrikes("red", king, battle.entities).map((s) => s.entity.id),
    ).not.toContain(king.id);
  });

  it("pins all three strike steps and current-health ordering with ID ties", () => {
    const { battle, spawn } = setup();
    const a = spawn("wizard", 4, 9),
      b = spawn("witch", 4, 9),
      c = spawn("musketeer", 4, 9);
    a.hp = 500;
    b.hp = 700;
    c.hp = 500;
    const plan = lightningStrikes("red", a, battle.entities);
    expect(plan.map((s) => [s.entity.id, s.step])).toEqual([
      [b.id, 15],
      [a.id, 29],
      [c.id, 43],
    ]);
    expect(selectLightningTarget("red", a, 3.5, battle.entities, [b.id])).toBe(
      a,
    );
  });

  it("keeps a shield from counting as body removal", () => {
    const { battle, spawn, target } = setup();
    const knight = spawn("dark-prince", 4, 9);
    knight.hp = 1;
    expect(knight.shield).toBeGreaterThan(0);
    expect(target()).toBeUndefined();
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, knight.x, knight.y).ok).toBe(true);
    step(battle, 15);
    expect(knight.hp).toBe(1);
    expect(knight.shield).toBe(0);
  });

  it("excludes hidden Tesla and friendly bodies from target priority", () => {
    const { battle, spawn } = setup();
    const tesla = spawn("tesla", 4, 9),
      wizard = spawn("wizard", 4, 9);
    const friend = spawn("giant", 4, 9);
    friend.team = "red";
    expect(tesla.burrow?.phase).toBe("hidden");
    expect(
      lightningStrikes("red", wizard, battle.entities).map((s) => s.entity.id),
    ).toEqual([wizard.id]);
  });

  it("counts a dashing body as a consumed strike without assigning it damage value", () => {
    const { battle, spawn, target } = setup();
    const bandit = spawn("bandit", 4, 9);
    bandit.dash = { target: 999, elapsed: 0, remaining: 1 };
    expect(lightningStrikes("red", bandit, battle.entities)).toHaveLength(1);
    expect(target()).toBeUndefined();
  });

  it("avoids another cast while a friendly Lightning cloud covers the group", () => {
    const { battle, spawn, target } = setup();
    for (const card of ["wizard", "witch", "musketeer"] as const)
      spawn(card, 4, 9);
    expect(battle.play("red", 0, 4, 9).ok).toBe(true);
    expect(target()).toBeUndefined();
  });

  it("uses actual Mirror cost to prefer a normal same-step Lightning", () => {
    const { battle, princess } = setup();
    princess.hp = 400;
    battle.players.red.hand = ["mirror", "lightning", "pekka", "pekka"];
    battle.players.red.lastPlayed = "lightning";
    battle.players.red.elixir = 7;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("lightning");
  });

  it("uses the first pulse to finish sudden death before slower missiles", () => {
    const { battle, princess } = setup(6000);
    princess.hp = 400;
    battle.players.red.hand = ["rocket", "lightning", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("lightning");
    step(battle);
    expect(battle.winner).toBe("red");
    expect(battle.reason).toBe("Sudden death");
    expect(battle.time).toBe(200.5);
  });

  it("forecasts an existing enemy cloud and preserves the remaining struck history", () => {
    const { battle, ownKing } = setup();
    ownKing.hp = 100;
    battle.players.blue.hand[0] = "lightning";
    battle.players.blue.elixir = 10;
    const princess = battle.entities.find((e) => e.team === "red" && !e.king)!;
    const point = {
      x: (ownKing.x + princess.x) / 2,
      y: (ownKing.y + princess.y) / 2,
    };
    expect(battle.play("blue", 0, point.x, point.y).ok).toBe(true);
    step(battle, 15);
    expect(battle.areas[0].struck).toEqual([princess.id]);
    const plan = lightningStrikes(
      "blue",
      point,
      battle.entities,
      battle.areas[0],
    );
    const predicted = plan.find((s) => s.entity.id === ownKing.id)!.step;
    expect(predicted).toBe(14);
    expect(
      launchedKingDeadline(
        "red",
        battle.entities,
        battle.projectiles,
        battle.areas,
      ),
    ).toBe(predicted);
    step(battle, predicted - 1);
    expect(ownKing.hp).toBe(100);
    step(battle, 1);
    expect(ownKing.hp).toBe(0);
    expect(battle.winner).toBe("blue");
  });

  it("uses the selected King's actual pulse instead of generic missile travel", () => {
    const { battle, king, spawn } = setup();
    king.hp = 50;
    const giant = spawn("giant", king.x, king.y);
    const race = createKingSpellRace(
      "lightning",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.stepAt(king)).toBe(29);
    expect(giant.hp).toBeGreaterThan(king.hp);
  });

  it("reads positions and clocks without mutating the battle", () => {
    const { battle, spawn, target } = setup();
    spawn("wizard", 4, 9);
    spawn("witch", 5, 9);
    spawn("musketeer", 6, 9);
    const before = JSON.stringify(battle);
    expect(target()).toBeDefined();
    expect(JSON.stringify(battle)).toBe(before);
  });

  it.each([
    { windup: 0.2, expected: "freeze" },
    { windup: 0.8, expected: "lightning" },
  ])(
    "compares Lightning's first pulse with a $windup-second fatal King windup",
    ({ windup, expected }) => {
      const { battle, spawn, king, ownKing } = setup();
      ownKing.hp = 100;
      king.hp = 50;
      const attacker = spawn("lumberjack", ownKing.x, ownKing.y + 1.5);
      Object.assign(attacker, {
        active: true,
        target: ownKing.id,
        cooldown: 100,
        pendingAttack: {
          target: ownKing.id,
          remaining: windup,
          damage: attacker.damage,
        },
      });
      battle.players.red.hand = ["lightning", "freeze", "pekka", "pekka"];
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(expected);
      step(battle, 15);
      expect(ownKing.hp).toBe(100);
      expect(battle.winner).toBe(expected === "lightning" ? "red" : null);
    },
  );

  it("orders the area strike before a same-step Poison shield packet", () => {
    const { battle, ownKing } = setup();
    ownKing.hp = 100;
    ownKing.shield = 1;
    ownKing.poison = { remaining: 0.1, elapsed: 29 / 30 };
    battle.areas.push({
      id: 900,
      card: "lightning",
      team: "blue",
      x: ownKing.x,
      y: ownKing.y,
      radius: 3.5,
      duration: 1.5,
      remaining: 1.5 - 14 / 30,
      hitAt: 0.46,
      struck: [],
    });
    expect(
      launchedKingDeadline(
        "red",
        battle.entities,
        battle.projectiles,
        battle.areas,
      ),
    ).toBe(Infinity);
    step(battle, 1);
    expect(ownKing.shield).toBe(0);
    expect(ownKing.hp).toBeCloseTo(100 - 49);
    expect(battle.winner).toBeNull();
  });
});
