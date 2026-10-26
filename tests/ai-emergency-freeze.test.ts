import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { perspective, snapshot } from "../src/network/perspective";
import {
  fatalKingWindups,
  finishesKingBefore,
} from "../src/game/king-spell-race";

function setup() {
  const battle = new Battle({ seed: 12, ai: false });
  for (const tower of battle.entities) tower.active = false;
  const king = battle.entities.find((e) => e.team === "red" && e.king)!;
  Object.assign(king, { hp: 100, active: true, activation: 0 });
  const spawn = (card: CardId, team: "blue" | "red", x: number, y: number) => {
    (
      battle as unknown as {
        spawn: (card: string, team: string, x: number, y: number) => void;
      }
    ).spawn(card, team, x, y);
    const entity = battle.entities.at(-1)!;
    Object.assign(entity, { deploy: 0, active: false });
    return entity;
  };
  spawn("giant", "red", 4, 20);
  spawn("witch", "red", 5, 20);
  const attacker = spawn("lumberjack", "blue", king.x, king.y + 2);
  Object.assign(attacker, {
    hp: 200,
    active: true,
    target: king.id,
    pendingAttack: { target: king.id, remaining: 0.2, damage: attacker.damage },
  });
  battle.players.red.hand = ["freeze", "clone", "pekka", "pekka"];
  battle.players.red.elixir = 4;
  return { battle, king, attacker, spawn };
}
const think = (battle: Battle) =>
  (battle as unknown as { think: () => void }).think();

describe("AI emergency Freeze defense", () => {
  it.each(["musketeer", "balloon", "sparky", "bowler", "executioner"] as const)(
    "defends before a fatal %s projectile instead of launching a late Rocket",
    (card) => {
      const { battle, king, attacker, spawn } = setup();
      if (card === "balloon") king.hp = 400;
      attacker.hp = 0;
      const ranged = spawn(
        card,
        "blue",
        king.x,
        king.y + (card === "balloon" ? 1 : 5.5),
      );
      Object.assign(ranged, {
        hp: 200,
        active: true,
        cooldown: 100,
        target: king.id,
        pendingAttack: {
          target: king.id,
          remaining: 0.2,
          damage: ranged.damage,
        },
      });
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["rocket", "freeze", "pekka", "pekka"];
      battle.players.red.elixir = 6;
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe("freeze");
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(card === "balloon" ? 70 : 100);
      expect(ranged.hp).toBeLessThanOrEqual(0);
    },
  );

  it.each([
    { card: "musketeer", distance: 5.5, expected: "zap" },
    { card: "balloon", distance: 1, expected: "zap" },
    { card: "sparky", distance: 3, expected: "freeze" },
    { card: "bowler", distance: 3.5, expected: "freeze" },
    { card: "bowler", distance: 6, expected: "zap" },
    { card: "executioner", distance: 3.5, expected: "freeze" },
    { card: "executioner", distance: 6, expected: "zap" },
  ] as const)(
    "uses the first $card contact at distance $distance when comparing Zap",
    ({ card, distance, expected }) => {
      const { battle, king, attacker, spawn } = setup();
      attacker.hp = 0;
      const ranged = spawn(card, "blue", king.x, king.y + distance);
      Object.assign(ranged, {
        hp: 200,
        active: true,
        cooldown: 100,
        target: king.id,
        pendingAttack: {
          target: king.id,
          remaining: 0.05,
          damage: ranged.damage,
        },
      });
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(expected);
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(100);
      expect(battle.winner).toBe(expected === "zap" ? "red" : null);
    },
  );

  it.each(["rocket", "fireball", "arrows", "poison"] as const)(
    "defends the King instead of launching a %s finisher that would arrive after a fatal swing",
    (card) => {
      const { battle, king, attacker } = setup();
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = [card, "freeze", "pekka", "pekka"];
      battle.players.red.elixir = Math.max(4, CARD_MAP[card].cost);
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe("freeze");
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(100);
      expect(attacker.hp).toBeLessThanOrEqual(0);
      expect(battle.winner).toBeNull();
    },
  );

  it.each([
    { name: "same-step Zap", remaining: 0.15, expected: "freeze" },
    { name: "earlier Zap", remaining: 0.2, expected: "zap" },
    {
      name: "Rage accelerates the swing",
      remaining: 0.2,
      rage: 2,
      expected: "freeze",
    },
    {
      name: "slow delays the swing",
      remaining: 0.15,
      slow: 2,
      expected: "zap",
    },
    {
      name: "Rage expires before combat",
      remaining: 0.2,
      rage: 1 / 30,
      expected: "zap",
    },
    {
      name: "slow expires before combat",
      remaining: 0.15,
      slow: 1 / 30,
      expected: "freeze",
    },
  ])(
    "compares the actual impact steps: $name",
    ({ remaining, rage, slow, expected }) => {
      const { battle, king, attacker } = setup();
      attacker.pendingAttack!.remaining = remaining;
      if (rage) attacker.rage = { remaining: rage };
      if (slow) attacker.slow = { remaining: slow };
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(expected);
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(100);
      expect(battle.winner).toBe(expected === "zap" ? "red" : null);
    },
  );

  it("checks a mirrored Rocket's travel before spending the extra elixir", () => {
    const { battle, king } = setup();
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
    battle.players.red.hand = ["mirror", "freeze", "pekka", "pekka"];
    battle.players.red.lastPlayed = "rocket";
    battle.players.red.elixir = 7;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("freeze");
    expect(battle.players.red.elixir).toBe(3);
    for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
    expect(king.hp).toBe(100);
  });

  it.each([0.1, 0.2, 0.5])(
    "accounts for the arrival of reserved friendly damage (%s seconds)",
    (remaining) => {
      const { battle, king } = setup();
      const target = battle.entities.find((e) => e.team === "blue" && e.king)!;
      target.hp = 300;
      const queued: Projectile = {
        id: 900,
        team: "red",
        source: 0,
        x: 9,
        y: 2,
        tx: target.x,
        ty: target.y,
        target: null,
        damage: 625,
        remaining,
        duration: remaining,
        splash: 2,
        air: true,
        style: "rocket",
        stun: 0,
        towerDamageFraction: 0.4,
      };
      battle.projectiles.push(queued);
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(
        remaining < 0.2 ? "zap" : "freeze",
      );
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(100);
      expect(battle.winner).toBe(remaining < 0.2 ? "red" : null);
    },
  );

  it.each(["rage", "ice-golem"] as const)(
    "includes a visible %s area's clock before combat",
    (card) => {
      const { battle, king, attacker } = setup();
      attacker.pendingAttack!.remaining = card === "rage" ? 0.2 : 0.15;
      battle.areas.push({
        id: 901,
        card,
        team: card === "rage" ? "blue" : "red",
        x: attacker.x,
        y: attacker.y,
        radius: 3,
        duration: 6,
        remaining: 6,
      });
      battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 50;
      battle.players.red.hand = ["zap", "freeze", "pekka", "pekka"];
      think(battle);
      const expected = card === "rage" ? "freeze" : "zap";
      expect(battle.actions.at(-1)?.card).toBe(expected);
      for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
      expect(king.hp).toBe(100);
      expect(battle.winner).toBe(expected === "zap" ? "red" : null);
    },
  );

  it("keeps a Poison finisher that actually beats a slowed fatal windup", () => {
    const { battle, king, attacker } = setup();
    attacker.pendingAttack!.remaining = 1;
    attacker.slow = { remaining: 2 };
    battle.entities.find((e) => e.team === "blue" && e.king)!.hp = 40;
    battle.players.red.hand = ["poison", "freeze", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
    expect(king.hp).toBe(100);
    expect(battle.winner).toBe("red");
  });

  it("stops a fatal King windup before supporting a distant push", () => {
    const control = setup();
    for (let i = 0; i < 30 && !control.battle.winner; i++)
      control.battle.step();
    expect(control.battle.winner).toBe("blue");
    const { battle, king, attacker } = setup();
    expect(areaSpellTarget("clone", "red", battle.entities)).toBeDefined();
    think(battle);
    expect(battle.actions.at(-1)).toMatchObject({
      card: "freeze",
      x: attacker.x,
      y: attacker.y,
    });
    expect(battle.players.red.elixir).toBe(0);
    for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
    expect(king.hp).toBe(100);
    expect(attacker.hp).toBeLessThanOrEqual(0);
    expect(battle.winner).toBeNull();
    expect(battle.players.red.hand).toContain("clone");
  });

  it("respects Mirror's cost when it repeats the emergency Freeze", () => {
    const { battle, king, attacker } = setup();
    battle.players.red.hand = ["mirror", "clone", "pekka", "pekka"];
    battle.players.red.lastPlayed = "freeze";
    battle.players.red.elixir = 5;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("mirror");
    expect(battle.areas.at(-1)?.card).toBe("freeze");
    expect(battle.players.red.elixir).toBe(0);
    for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
    expect(king.hp).toBe(100);
    expect(attacker.hp).toBeLessThanOrEqual(0);
  });

  it("uses the actual charged windup packet when ordinary damage would not be fatal", () => {
    const { battle, king, attacker, spawn } = setup();
    attacker.hp = 0;
    const prince = spawn("prince", "blue", king.x, king.y + 2);
    Object.assign(prince, {
      hp: 200,
      active: true,
      move: 2.3,
      chargeDistance: 2.5,
      cooldown: 0,
      target: king.id,
    });
    king.hp = prince.damage + 1;
    battle.step();
    expect(prince.damage).toBeLessThan(king.hp);
    expect(prince.pendingAttack?.damage).toBe(prince.damage * 2);
    expect(prince.pendingAttack!.damage).toBeGreaterThan(king.hp);
    const before = king.hp;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("freeze");
    for (let i = 0; i < 120 && !battle.winner; i++) battle.step();
    expect(king.hp).toBe(before);
    expect(prince.hp).toBeLessThanOrEqual(0);
  });

  it("does not mistake a cancelled, nonfatal or already released attack for an emergency", () => {
    const { battle, king, attacker } = setup();
    const invalid: Partial<Entity>[] = [
      { pendingAttack: undefined },
      {
        pendingAttack: { target: king.id, remaining: 0.2, damage: king.hp - 1 },
      },
      { pendingAttack: { target: king.id, remaining: 2, damage: king.hp } },
      { y: 12 },
      { active: false },
      { deploy: 1 },
      { stun: 0.1 },
      {
        pendingAttack: {
          target: battle.entities[0].id,
          remaining: 0.2,
          damage: king.hp,
        },
      },
    ];
    for (const changed of invalid)
      expect(
        areaSpellTarget("freeze", "red", [king, { ...attacker, ...changed }]),
      ).toBeUndefined();
    expect(
      areaSpellTarget(
        "freeze",
        "red",
        [king, attacker],
        [
          {
            id: 99,
            team: "red",
            card: "freeze",
            x: attacker.x,
            y: attacker.y,
            radius: 3,
            remaining: 2,
            duration: 4,
          },
        ],
      ),
    ).toBeUndefined();
  });

  it("keeps a faster winning King hit ahead of emergency protection", () => {
    const { battle, attacker } = setup();
    attacker.pendingAttack!.remaining = 0.4;
    const enemyKing = battle.entities.find((e) => e.team === "blue" && e.king)!;
    enemyKing.hp = 50;
    battle.players.red.hand = ["freeze", "zap", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    for (let i = 0; i < 30 && !battle.winner; i++) battle.step();
    expect(battle.winner).toBe("red");
  });

  it("keeps emergency planning read-only, legal and equivalent from either side", () => {
    const { battle, attacker } = setup();
    const enemyKing = battle.entities.find((e) => e.team === "blue" && e.king)!;
    enemyKing.poison = { remaining: 0.5, elapsed: 0.95 };
    battle.areas.push(
      {
        id: 902,
        team: "blue",
        card: "rage",
        x: attacker.x,
        y: attacker.y,
        radius: 3,
        remaining: 0.4,
        duration: 6,
        hitAt: 5.7,
      },
      {
        id: 903,
        team: "red",
        card: "poison",
        x: enemyKing.x,
        y: enemyKing.y,
        radius: 3.5,
        remaining: 0.2,
        duration: 8,
        hitAt: 7.85,
      },
    );
    const before = structuredClone({
      entities: battle.entities,
      areas: battle.areas,
      projectiles: battle.projectiles,
    });
    const windups = fatalKingWindups("red", battle.entities, battle.areas);
    finishesKingBefore(
      "poison",
      "red",
      enemyKing,
      enemyKing,
      battle.projectiles,
      battle.areas,
      windups[0].step,
    );
    const target = areaSpellTarget("freeze", "red", battle.entities)!;
    expect(target).toBeDefined();
    expect(battle.canPlace("red", "freeze", target.x, target.y).ok).toBe(true);
    const reversed = perspective(snapshot(battle), "red");
    expect(areaSpellTarget("freeze", "blue", reversed.entities)).toMatchObject({
      x: 18 - target.x,
      y: 32 - target.y,
    });
    expect({
      entities: battle.entities,
      areas: battle.areas,
      projectiles: battle.projectiles,
    }).toEqual(before);
  });
});
