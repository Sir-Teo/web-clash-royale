import { describe, expect, it } from "vitest";
import {
  Battle,
  type AreaEffect,
  type Entity,
  type Projectile,
} from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import {
  damageSpellTarget,
  pendingSpellDamage,
} from "../src/game/spell-targeting";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { createSpellDamageReservation } from "../src/game/spell-reservations";
import { perspective, snapshot } from "../src/network/perspective";

function setup(ai = false) {
  const battle = new Battle({ seed: 1, ai });
  for (const e of battle.entities) e.active = false;
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
  const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
  const cloud = (
    point: Entity,
    extra: Partial<AreaEffect> = {},
  ): AreaEffect => ({
    id: 900,
    card: "lightning",
    team: "red",
    x: point.x,
    y: point.y,
    radius: 3.5,
    duration: 1.5,
    remaining: 1.5,
    hitAt: 0.46,
    struck: [],
    ...extra,
  });
  const shot = (point: Entity, damage = 100): Projectile => ({
    id: 901,
    team: "red",
    source: 0,
    x: point.x,
    y: point.y,
    tx: point.x,
    ty: point.y,
    target: null,
    damage,
    remaining: 1 / 30,
    duration: 1 / 30,
    splash: 2,
    air: true,
    style: "fireball",
    stun: 0,
    towerDamageFraction: 0.4,
  });
  const reserve = (e: Entity) =>
    pendingSpellDamage(
      e,
      "red",
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
  return { battle, spawn, princess, cloud, shot, reserve };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, count: number) => {
  for (let i = 0; i < count && !b.winner; i++) b.step();
};

describe("coordinated spell reservations", () => {
  it("holds a newly drawn Fireball one step before the existing Lightning finisher", () => {
    const { battle, spawn, princess } = setup(true);
    princess.hp = 100;
    spawn("witch", 3, 25);
    spawn("wizard", 5, 25);
    battle.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    battle.players.red.queue = ["fireball", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 10;
    step(battle, 150);
    expect(
      battle.actions.filter((a) => a.team === "red").map((a) => a.card),
    ).toEqual(["lightning"]);
    expect(battle.players.red.hand).toContain("fireball");
    expect(princess.hp).toBe(0);
    expect(battle.players.red.crowns).toBe(1);
  });

  it("reserves the tower fraction and suppresses both direct and Poison finishers", () => {
    const { battle, princess, cloud, reserve } = setup();
    princess.hp = 100;
    battle.areas.push(cloud(princess));
    expect(reserve(princess)).toBe(552);
    expect(
      damageSpellTarget("fireball", "red", battle.entities, [], battle.areas),
    ).toBeUndefined();
    expect(
      areaSpellTarget("poison", "red", battle.entities, battle.areas),
    ).toBeUndefined();
  });

  it("reserves full troop damage for a selected Lightning body", () => {
    const { battle, spawn, cloud, reserve } = setup();
    const giant = spawn("giant", 4, 9);
    battle.areas.push(cloud(giant));
    expect(reserve(giant)).toBe(CARD_MAP.lightning.damage);
  });

  it("keeps a fourth unselected tower available for a new finisher", () => {
    const { battle, spawn, princess, cloud, reserve } = setup();
    princess.hp = 100;
    for (let i = 0; i < 3; i++) spawn("giant", princess.x, princess.y);
    battle.areas.push(cloud(princess));
    expect(reserve(princess)).toBe(0);
    expect(
      damageSpellTarget("fireball", "red", battle.entities, [], battle.areas)
        ?.lethalTower,
    ).toBe(princess.id);
  });

  it("does not reserve a body already struck by the cloud", () => {
    const { battle, spawn, cloud, reserve } = setup();
    const giant = spawn("giant", 4, 9);
    battle.areas.push(
      cloud(giant, { remaining: 1, hitAt: 0.92, struck: [giant.id] }),
    );
    expect(reserve(giant)).toBe(0);
  });

  it("ignores enemy/expired clouds and requires board context for Lightning selection", () => {
    const { battle, princess, cloud, reserve } = setup();
    battle.areas.push(
      cloud(princess, { team: "blue" }),
      cloud(princess, { remaining: 0 }),
    );
    expect(reserve(princess)).toBe(0);
    expect(pendingSpellDamage(princess, "red", [], [cloud(princess)])).toBe(0);
  });

  it("orders same-step Lightning before a projectile without shield overflow", () => {
    const { battle, spawn, cloud, shot, reserve } = setup();
    const guard = spawn("dark-prince", 4, 9);
    guard.hp = 500;
    guard.shield = 50;
    battle.areas.push(cloud(guard, { remaining: 1.5 - 14 / 30 }));
    battle.projectiles.push(shot(guard));
    expect(reserve(guard)).toBe(150);
    step(battle, 1);
    expect(guard.shield).toBe(0);
    expect(guard.hp).toBe(400);
  });

  it("reserves applied troop Poison without assuming it stays inside a cloud", () => {
    const { battle, spawn, reserve } = setup();
    const knight = spawn("knight", 4, 9);
    battle.areas.push({
      id: 900,
      card: "poison",
      team: "red",
      x: 4,
      y: 9,
      radius: 3.5,
      duration: 8,
      remaining: 8,
    });
    expect(reserve(knight)).toBe(0);
    knight.poison = { remaining: 0.5, elapsed: 0.9 };
    expect(reserve(knight)).toBe(CARD_MAP.poison.damage);
  });

  it("reserves a lingering tower tick after the Poison area expires", () => {
    const { battle, princess, reserve } = setup();
    princess.hp = 100;
    princess.poison = { remaining: 0.2, elapsed: 0.9 };
    expect(reserve(princess)).toBeCloseTo(49);
    step(battle, 6);
    expect(princess.hp).toBeCloseTo(100 - 49);
  });

  it.each(["troop", "tower"] as const)(
    "reserves a projectile's actual %s packet",
    (kind) => {
      const { battle, spawn, princess, shot, reserve } = setup();
      const body = kind === "troop" ? spawn("knight", 4, 9) : princess;
      const hp = body.hp;
      battle.projectiles.push(shot(body));
      const damage = kind === "tower" ? 40 : 100;
      expect(reserve(body)).toBe(damage);
      step(battle, 1);
      expect(body.hp).toBe(hp - damage);
    },
  );

  it("still accelerates Lightning with Zap before a fatal King shot", () => {
    const { battle, spawn, cloud, shot } = setup();
    battle.tick = 6000;
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    const ownKing = battle.entities.find((e) => e.team === "red" && e.king)!;
    king.hp = 50;
    ownKing.hp = 100;
    spawn("giant", king.x, king.y);
    battle.areas.push(cloud(king));
    battle.projectiles.push({
      ...shot(ownKing, 500),
      team: "blue",
      remaining: 0.6,
      duration: 0.6,
    });
    battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 2;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 30);
    expect(battle.winner).toBe("red");
    expect(ownKing.hp).toBe(100);
  });

  it("keeps reservations symmetric in a rotated guest view", () => {
    const { battle, princess, cloud, reserve } = setup();
    battle.areas.push(cloud(princess));
    const expected = reserve(princess);
    const rotated = perspective(snapshot(battle), "red");
    const target = rotated.entities.find((e) => e.id === princess.id)!;
    expect(
      pendingSpellDamage(
        target,
        "blue",
        rotated.projectiles,
        rotated.areas,
        rotated.entities,
      ),
    ).toBe(expected);
  });

  it("caches read-only reservations without changing combat state", () => {
    const { battle, princess, cloud } = setup();
    battle.areas.push(cloud(princess));
    const before = JSON.stringify(battle);
    const reserve = createSpellDamageReservation(
      "red",
      battle.entities,
      battle.projectiles,
      battle.areas,
    );
    expect(reserve(princess)).toBe(552);
    expect(reserve(princess)).toBe(552);
    expect(JSON.stringify(battle)).toBe(before);
  });

  it("does not reserve a rolling Log against a flying Minion", () => {
    const { battle, spawn, reserve } = setup();
    const minion = spawn("minions", 4, 15);
    const hp = minion.hp;
    battle.players.red.hand[0] = "log";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 12).ok).toBe(true);
    expect(reserve(minion)).toBe(0);
    step(battle, 90);
    expect(minion.hp).toBe(hp);
  });
});
