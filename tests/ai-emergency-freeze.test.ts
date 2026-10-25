import { describe, expect, it } from "vitest";
import { Battle, type Entity } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { perspective, snapshot } from "../src/network/perspective";

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
    const { battle } = setup();
    const before = structuredClone(battle.entities);
    const target = areaSpellTarget("freeze", "red", battle.entities)!;
    expect(target).toBeDefined();
    expect(battle.canPlace("red", "freeze", target.x, target.y).ok).toBe(true);
    const reversed = perspective(snapshot(battle), "red");
    expect(areaSpellTarget("freeze", "blue", reversed.entities)).toMatchObject({
      x: 18 - target.x,
      y: 32 - target.y,
    });
    expect(battle.entities).toEqual(before);
  });
});
