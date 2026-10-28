import { attackReach } from "../src/game/attack-range";
import { describe, expect, it } from "vitest";
import { Battle, type Team } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { createKingDefense } from "../src/game/king-defense";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { perspective, snapshot } from "../src/network/perspective";
import { attackHitSteps } from "../src/game/attack-flight";
import log from "../src/game/log-data.json";

function setup(team: Team = "red") {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === team && e.king)!;
  king.hp = 300;
  const enemy = team === "red" ? "blue" : "red";
  const spawn = (
    card: CardId,
    x = king.x,
    y = king.y + (team === "red" ? 2 : -2),
    remaining = 0.2,
    damage?: number,
  ) => {
    (
      battle as unknown as {
        spawn: (card: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(card, enemy, x, y);
    const body = battle.entities.at(-1)!;
    Object.assign(body, {
      deploy: 0,
      active: true,
      cooldown: 100,
      spawnTimer: 100,
      target: king.id,
      pendingAttack: {
        target: king.id,
        remaining,
        damage: damage ?? body.damage,
      },
    });
    if (body.burrow)
      Object.assign(body.burrow, { phase: "exposed", exposure: 1, idle: 0 });
    return body;
  };
  const incoming = (damage: number, step: number) =>
    battle.projectiles.push({
      id: 900 + battle.projectiles.length,
      team: enemy,
      source: 800,
      x: king.x,
      y: king.y,
      tx: king.x,
      ty: king.y,
      target: king.id,
      damage,
      remaining: step / 30,
      duration: step / 30,
      splash: 0,
      air: true,
      style: "musketeer",
      stun: 0,
    });
  const forecast = () =>
    createKingDefense(team, battle.entities, battle.projectiles, battle.areas);
  battle.players[team].hand = ["rocket", "freeze", "tornado", "pekka"];
  battle.players[team].elixir = 6;
  return { battle, king, spawn, incoming, forecast };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, count: number) => {
  for (let i = 0; i < count && !b.winner; i++) b.step();
};

describe("combined pending King damage", () => {
  it("combines two individually nonfatal swings into their actual lethal step", () => {
    const { battle, king, spawn, forecast } = setup();
    for (const x of [8.5, 9.5])
      expect(spawn("lumberjack", x).damage).toBeLessThan(king.hp);
    expect(forecast().baseline).toBe(6);
    expect(forecast().threats).toHaveLength(2);
    step(battle, 5);
    expect(battle.winner).toBeNull();
    step(battle, 1);
    expect(battle.winner).toBe("blue");
  });

  it.each(["freeze", "tornado"] as const)(
    "uses %s instead of a late Rocket against combined swings",
    (card) => {
      const { battle, king, spawn } = setup();
      for (const x of [8.5, 9.5]) spawn("lumberjack", x);
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["rocket", card, "pekka", "pekka"];
      const target = areaSpellTarget(
        card,
        "red",
        battle.entities,
        battle.areas,
        battle.projectiles,
      )!;
      expect(target.protectsKing).toBe(true);
      expect(target.kingThreatStep).toBe(6);
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(card);
      step(battle, 30);
      expect(king.hp).toBe(300);
    },
  );

  it("can prevent the loss by freezing only one of two distant contributors", () => {
    const { battle, king, spawn, forecast } = setup();
    const a = spawn("musketeer", 4, 7, 0.2, 200);
    spawn("musketeer", 14, 7, 0.2, 200);
    const context = forecast();
    expect(Number.isFinite(context.baseline)).toBe(true);
    expect(context.evaluate("freeze", a)).toMatchObject({
      deathStep: Infinity,
      improves: true,
    });
    expect(battle.play("red", 1, a.x, a.y).ok).toBe(true);
    step(battle, context.baseline);
    expect(battle.winner).toBeNull();
    expect(king.hp).toBe(100);
  });

  it.each([
    { arrival: 3, lethal: 6 },
    { arrival: 10, lethal: 10 },
  ])(
    "combines a pending swing with a shot on step $arrival",
    ({ arrival, lethal }) => {
      const { battle, king, spawn, incoming, forecast } = setup();
      const a = spawn("lumberjack", 9, 4.5, 0.2, 200);
      incoming(150, arrival);
      const context = forecast();
      expect(context.baseline).toBe(lethal);
      expect(context.evaluate("freeze", a)).toMatchObject({
        improves: true,
        deathStep: Infinity,
      });
      battle.play("red", 1, a.x, a.y);
      step(battle, lethal);
      expect(king.hp).toBe(150);
    },
  );

  it("combines applied Poison with the pending packet", () => {
    const { battle, king, spawn, forecast } = setup();
    king.hp = 270;
    king.poison = { remaining: 0.1, elapsed: 0.95 };
    const a = spawn("lumberjack");
    expect(forecast().baseline).toBe(6);
    expect(forecast().evaluate("freeze", a).improves).toBe(true);
    battle.play("red", 1, a.x, a.y);
    step(battle, 6);
    expect(king.hp).toBeCloseTo(270 - 49);
  });

  it("does not claim a rescue if the released shot still kills first", () => {
    const { king, spawn, incoming, forecast } = setup();
    king.hp = 100;
    const a = spawn("lumberjack");
    incoming(200, 3);
    expect(forecast().baseline).toBe(3);
    expect(forecast().evaluate("freeze", a)).toMatchObject({
      improves: false,
      deathStep: 3,
    });
  });

  it("recognizes a real delay even when a later released shot is still fatal", () => {
    const { battle, king, spawn, incoming, forecast } = setup();
    for (const x of [8.5, 9.5]) spawn("lumberjack", x);
    incoming(500, 12);
    const result = forecast().evaluate("freeze", { x: 9, y: 4.5 });
    expect(result).toMatchObject({
      baseline: 6,
      deathStep: 12,
      improves: true,
    });
    const target = areaSpellTarget(
      "freeze",
      "red",
      battle.entities,
      battle.areas,
      battle.projectiles,
    )!;
    expect(target.protectsKing).toBe(true);
    battle.play("red", 1, target.x, target.y);
    step(battle, 11);
    expect(king.hp).toBe(300);
    step(battle, 1);
    expect(battle.winner).toBe("blue");
  });

  it("orders a pending melee hit before an existing same-step projectile", () => {
    const { battle, king, spawn, incoming, forecast } = setup();
    king.hp = 100;
    king.shield = 50;
    spawn("lumberjack", 9, 4.5, 0.1, 200);
    incoming(60, 3);
    expect(forecast().baseline).toBe(Infinity);
    step(battle, 3);
    expect(king.shield).toBe(0);
    expect(king.hp).toBe(40);
  });

  it("orders a pending projectile before a Log child born later in the same frame", () => {
    const { battle, king, spawn, forecast } = setup();
    king.hp = 20;
    king.shield = 50;
    const a = spawn("musketeer", 9, king.y + 3.5, 0.1, 200);
    const flight = attackHitSteps(a, king);
    const landing =
      king.y +
      log.collisionRadius +
      king.radius +
      ((flight - 1.5) * log.rollingSpeed) / 30;
    battle.projectiles.push({
      id: 900,
      team: "blue",
      source: 0,
      x: 9,
      y: 20,
      tx: 9,
      ty: landing,
      damage: 60,
      remaining: 0.1,
      duration: 0.1,
      target: null,
      splash: 0,
      air: false,
      style: "log-launch",
      stun: 0,
    });
    const expected = 3 + flight - 1;
    expect(forecast().baseline).toBe(expected);
    step(battle, expected - 1);
    expect(battle.winner).toBeNull();
    step(battle, 1);
    expect(battle.winner).toBe("blue");
  });

  it("counts both passes of the same pending Executioner axe", () => {
    const { battle, king, spawn, forecast } = setup();
    spawn("executioner", 9, 6.5, 0.2, 200);
    const context = forecast();
    expect(context.attempts[0].packets).toHaveLength(2);
    expect(context.baseline).toBe(context.attempts[0].packets[1].step);
    step(battle, context.baseline - 1);
    expect(king.hp).toBe(100);
    step(battle, 1);
    expect(battle.winner).toBe("blue");
  });

  it("recomputes the arrival of a shot whose shooter survives the pull", () => {
    const { battle, king, spawn, forecast } = setup();
    king.hp = 100;
    spawn("musketeer", 9, 6, 0.2, 200);
    const point = { x: 9, y: 2 };
    const context = forecast();
    const pulled = context.evaluate("tornado", point);
    expect(pulled.deathStep).toBeLessThan(context.baseline);
    expect(pulled.worsens).toBe(true);
    battle.play("red", 2, point.x, point.y);
    step(battle, pulled.deathStep - 1);
    expect(battle.winner).toBeNull();
    step(battle, 1);
    expect(battle.winner).toBe("blue");
  });

  it("preserves a currently controlled pending attack when evaluating a second pull", () => {
    const { battle, king, spawn, forecast } = setup();
    king.hp = 100;
    spawn("lumberjack");
    battle.areas.push({
      id: 900,
      card: "tornado",
      team: "red",
      x: 9,
      y: 9,
      radius: 5.5,
      duration: 3.05,
      remaining: 3.05,
      hitAt: 0,
    });
    const context = forecast();
    expect(context.baseline).toBe(Infinity);
    expect(context.evaluate("tornado", { x: 9, y: 1 })).toMatchObject({
      deathStep: 6,
      worsens: true,
      improves: false,
    });
  });

  it("does not invent pending hits from inactive, deploying, stunned, dashing or cancelled attackers", () => {
    const { spawn, forecast } = setup();
    spawn("lumberjack").active = false;
    spawn("lumberjack").deploy = 1;
    spawn("lumberjack").stun = 1;
    spawn("lumberjack").dash = {} as any;
    spawn("lumberjack").pendingAttack = undefined;
    expect(forecast().attempts).toEqual([]);
    expect(forecast().baseline).toBe(Infinity);
  });

  it("keeps range-cancelled windups available to detect a pull that restores them", () => {
    const { king, spawn, forecast } = setup();
    king.hp = 100;
    const a = spawn("lumberjack", 9, 4.9, 1 / 30, 200);
    a.y = king.y + attackReach(a, king) + 0.1;
    const context = forecast();
    expect(context.baseline).toBe(Infinity);
    expect(context.evaluate("tornado", king).worsens).toBe(true);
    expect(a.pendingAttack).toBeDefined();
  });

  it.each([
    { remaining: 0.2, expected: "zap" },
    { remaining: 0.15, expected: "freeze" },
  ] as const)(
    "compares a Zap against the combined deadline ($remaining)",
    ({ remaining, expected }) => {
      const { battle, spawn } = setup();
      for (const x of [8.5, 9.5]) spawn("lumberjack", x, 4.5, remaining);
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(expected);
      step(battle, 6);
      expect(battle.winner).toBe(expected === "zap" ? "red" : null);
    },
  );

  it("uses ordinary Freeze instead of its more expensive Mirror", () => {
    const { battle, spawn } = setup();
    for (const x of [8.5, 9.5]) spawn("lumberjack", x);
    battle.players.red.hand = ["mirror", "freeze", "pekka", "pekka"];
    battle.players.red.lastPlayed = "freeze";
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("freeze");
    expect(battle.players.red.elixir).toBe(2);
  });

  it.each([
    { arrival: 2, defend: false },
    { arrival: 6, defend: true },
  ])(
    "preserves an existing King hit on step $arrival without conceding a draw",
    ({ arrival, defend }) => {
      const { battle, king, spawn, forecast } = setup();
      for (const x of [8.5, 9.5]) spawn("lumberjack", x);
      const enemy = battle.entities.find((e) => e.team === "blue" && e.king)!;
      enemy.hp = 50;
      battle.projectiles.push({
        id: 900,
        team: "red",
        source: 0,
        x: 9,
        y: 2,
        tx: enemy.x,
        ty: enemy.y,
        target: null,
        damage: 200,
        remaining: arrival / 30,
        duration: arrival / 30,
        splash: 2.5,
        air: true,
        style: "zap",
        stun: 0,
        towerDamageFraction: 0.4,
      });
      battle.players.red.hand = ["freeze", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = 4;
      expect(forecast().evaluate("freeze", { x: 9, y: 4.5 }).improves).toBe(
        defend,
      );
      think(battle);
      expect(battle.actions.map((a) => a.card)).toEqual(
        defend ? ["freeze"] : [],
      );
      step(battle, arrival);
      expect(battle.winner).toBe("red");
      expect(king.hp).toBe(300);
      expect(battle.players.red.elixir).toBeGreaterThanOrEqual(defend ? 0 : 4);
    },
  );

  it.each([
    { remaining: 0.2, defend: false },
    { remaining: 1 / 30, defend: true },
  ])(
    "respects a winning regulation boundary with windup $remaining",
    ({ remaining, defend }) => {
      const { battle, king, spawn } = setup();
      battle.tick = 5399;
      const princess = battle.entities.find(
        (e) => e.team === "blue" && !e.king,
      )!;
      battle.entities = battle.entities.filter((e) => e.id !== princess.id);
      battle.players.red.crowns = 1;
      for (const x of [8.5, 9.5]) spawn("lumberjack", x, 4.5, remaining);
      battle.players.red.hand = ["freeze", "pekka", "pekka", "pekka"];
      battle.players.red.elixir = 4;
      think(battle);
      expect(battle.actions.map((a) => a.card)).toEqual(
        defend ? ["freeze"] : [],
      );
      step(battle, 1);
      expect(battle.winner).toBe("red");
      expect(king.hp).toBe(300);
    },
  );

  it("returns symmetric cached results without moving entities or consuming RNG", () => {
    const { battle, spawn, forecast } = setup();
    for (const x of [8.5, 9.5]) spawn("lumberjack", x);
    const before = JSON.stringify(battle);
    const context = forecast();
    const point = { x: 9, y: 4.5 };
    const result = context.evaluate("freeze", point);
    expect(context.evaluate("freeze", point)).toBe(result);
    const guest = perspective(snapshot(battle), "red");
    const rotated = createKingDefense(
      "blue",
      guest.entities,
      guest.projectiles,
      guest.areas,
    );
    expect(rotated.baseline).toBe(context.baseline);
    expect(rotated.evaluate("freeze", { x: 9, y: 27.5 })).toEqual(result);
    expect(JSON.stringify(battle)).toBe(before);
  });

  it.each(["freeze", "tornado", "split"] as const)(
    "uses the ordinary AI timer for the combined %s defense",
    (card) => {
      const b = new Battle({ seed: 12, ai: true });
      for (const e of b.entities) e.active = false;
      const king = b.entities.find((e) => e.team === "red" && e.king)!;
      Object.assign(king, { hp: 300, active: true, cooldown: 3 });
      b.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      if (card === "split") {
        b.entities = b.entities.filter((e) => !(e.team === "red" && !e.king));
        b.players.blue.crowns = 2;
      }
      for (const x of card === "split" ? [4, 14] : [8.5, 9.5]) {
        (b as any).spawn(
          card === "split" ? "musketeer" : "lumberjack",
          "blue",
          x,
          card === "split" ? 7 : 4.5,
        );
        Object.assign(b.entities.at(-1)!, {
          hp: 200,
          deploy: card === "split" ? 2.4 : 2.3,
        });
      }
      const spell = card === "tornado" ? "tornado" : "freeze";
      b.players.red.hand = ["rocket", spell, "pekka", "pekka"];
      b.players.red.queue = ["pekka", "pekka", "pekka", "pekka"];
      b.players.red.elixir = 6;
      step(b, 120);
      expect(
        b.actions
          .filter((a) => a.team === "red")
          .map((a) => ({ card: a.card, tick: a.tick })),
      ).toEqual([{ card: spell, tick: 74 }]);
      expect(king.hp).toBe(card === "split" ? 82 : 300);
      expect(b.winner).toBeNull();
    },
  );

  for (const team of ["red", "blue"] as const)
    it.each([
      "lumberjack",
      "miner",
      "musketeer",
      "balloon",
      "sparky",
      "bowler",
      "executioner",
      "tesla",
      "x-bow",
      "princess",
      "ice-wizard",
      "fire-spirits",
    ] as const)(
      `${team}: matches actual packets of one pending %s attack`,
      (card) => {
        const { battle, king, spawn, forecast } = setup(team);
        king.hp = 100_000;
        const direction = team === "red" ? 1 : -1;
        const body = spawn(
          card,
          king.x,
          king.y +
            direction *
              (card === "balloon"
                ? 1.5
                : card === "lumberjack" ||
                    card === "miner" ||
                    card === "fire-spirits"
                  ? 2
                  : 4),
        );
        const packets = forecast().attempts[0].packets;
        expect(packets.length).toBeGreaterThan(0);
        const actual: { step: number; damage: number }[] = [];
        const last = Math.max(...packets.map((p) => p.step)) + 2;
        let hp = king.hp;
        for (let i = 1; i <= last; i++) {
          battle.step();
          if (king.hp < hp) actual.push({ step: i, damage: hp - king.hp });
          hp = king.hp;
        }
        expect(actual).toEqual(
          packets.map((p) => ({ step: p.step, damage: p.damage })),
        );
        expect(body.pendingAttack).toBeUndefined();
      },
    );
});
