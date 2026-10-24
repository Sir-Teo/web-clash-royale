import { describe, expect, it, vi } from "vitest";
import { Battle, type Entity } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { buildingLureTarget } from "../src/game/building-lure";
import { perspective, snapshot } from "../src/network/perspective";

function scene() {
  const b = new Battle({ seed: 8, ai: false });
  for (const e of b.entities) e.active = false;
  const balloon = unit(b, "balloon", 14, 13);
  b.step();
  b.players.red.hand = ["cannon", "giant", "hog-rider", "prince"];
  b.players.red.elixir = 3;
  return { b, balloon };
}
function unit(
  b: Battle,
  id: CardId,
  x: number,
  y: number,
  extra: Partial<Entity> = {},
) {
  (b as any).spawn(id, "blue", x, y);
  const e = b.entities.at(-1)!;
  Object.assign(e, { deploy: 0 }, extra);
  return e;
}
function lure(b: Battle, threat: Entity, card: CardId = "cannon") {
  return buildingLureTarget(
    card,
    "red",
    threat,
    b.entities,
    (p) => b.canPlace("red", card, p.x, p.y).ok,
  );
}

describe("Cannon air distraction", () => {
  it("buys a real Balloon interception and takes its first hit without shooting air", () => {
    const { b, balloon } = scene();
    expect(b.entities.find((e) => e.id === balloon.target)?.kind).toBe("tower");
    (b as any).think();
    expect(b.actions).toHaveLength(1);
    expect(b.actions[0]).toMatchObject({ card: "cannon", x: 9, y: 10 });
    expect(b.players.red.elixir).toBe(0);
    const cannon = b.entities.find((e) => e.card === "cannon")!;
    b.step();
    expect(balloon.target).toBe(cannon.id);
    for (
      let i = 0;
      i < 400 &&
      !b.events.some((e) => e.type === "hit" && e.card === "balloon");
      i++
    )
      b.step();
    expect(
      b.events.find((e) => e.type === "hit" && e.card === "balloon"),
    ).toMatchObject({ x: cannon.x, y: cannon.y, value: 640 });
    expect(cannon.hp).toBeLessThan(cannon.maxHp);
    expect(cannon.target).toBeNull();
    expect(b.projectiles.some((p) => p.source === cannon.id)).toBe(false);
    expect(
      b.entities
        .filter((e) => e.team === "red" && e.kind === "tower")
        .every((e) => e.hp === e.maxHp),
    ).toBe(true);
  });
  it("searches useful legal positions around a hidden occupied center", () => {
    const { b, balloon } = scene();
    const tesla = unit(b, "tesla", 9, 10, { team: "red", active: false });
    tesla.burrow = { exposure: 0, idle: 0, phase: "hidden" };
    expect(lure(b, balloon)).toEqual({ x: 11.5, y: 10 });
    (b as any).think();
    expect(b.actions[0]).toMatchObject({ card: "cannon", x: 11.5, y: 10 });
    b.step();
    expect(b.entities.find((e) => e.id === balloon.target)?.card).toBe(
      "cannon",
    );
  });
  it("does not try to distract flyers that can attack troops", () => {
    const { b, balloon } = scene();
    balloon.hp = 0;
    const horde = unit(b, "minion-horde", 14, 13);
    expect(lure(b, horde)).toBeUndefined();
    (b as any).think();
    expect(b.actions).toEqual([]);
  });
  it("rejects friendly, dead, ground and non-building candidates", () => {
    const { b, balloon } = scene();
    for (const change of [{ team: "red" as const }, { hp: 0 }, { air: false }])
      expect(lure(b, { ...balloon, ...change })).toBeUndefined();
    expect(lure(b, balloon, "knight")).toBeUndefined();
    expect(lure(b, balloon, "tesla")).toBeUndefined();
  });
  it("does not spend when the Balloon is already engaged with a Crown Tower", () => {
    const { b, balloon } = scene();
    const tower = b.entities.find((e) => e.id === balloon.target)!;
    Object.assign(balloon, { x: tower.x, y: tower.y + 1.5 });
    expect(lure(b, balloon)).toBeUndefined();
    (b as any).think();
    expect(b.actions).toEqual([]);
  });
  it("does not duplicate an existing visible lure, even before it acquires that target", () => {
    const { b, balloon } = scene();
    const cannon = unit(b, "cannon", 9, 10, { team: "red" });
    expect(lure(b, balloon)).toBeUndefined();
    balloon.target = cannon.id;
    expect(lure(b, balloon)).toBeUndefined();
    (b as any).think();
    expect(b.actions).toEqual([]);
  });
  it("rejects blocked positions, positions outside sight and absent living towers", () => {
    const { b, balloon } = scene();
    expect(
      buildingLureTarget("cannon", "red", balloon, b.entities, () => false),
    ).toBeUndefined();
    expect(lure(b, { ...balloon, x: 18, y: 16, target: null })).toBeUndefined();
    for (const e of b.entities)
      if (e.kind === "tower" && e.team === "red") e.hp = 0;
    expect(lure(b, balloon)).toBeUndefined();
  });
  it("prefers an affordable direct air counter over a distraction", () => {
    for (const counter of ["musketeer", "tesla"] as const) {
      const { b } = scene();
      b.players.red.hand[1] = counter;
      b.players.red.elixir = 4;
      (b as any).think();
      expect(b.actions[0].card).toBe(counter);
      expect(CARD_MAP[b.actions[0].card].hitsAir).toBe(true);
    }
  });
  it("waits when Cannon is unaffordable", () => {
    const { b } = scene();
    b.players.red.elixir = 2.9;
    (b as any).think();
    expect(b.actions).toEqual([]);
  });
  it("mirrors the fallback exactly and reads entities without RNG or mutations", () => {
    const { b, balloon } = scene();
    const before = structuredClone(b.entities);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw Error("RNG consumed");
    });
    try {
      const point = buildingLureTarget(
        "cannon",
        "red",
        balloon,
        b.entities,
        (p) => p.x !== 9,
      )!;
      const rotated = perspective(snapshot(b), "red").entities;
      expect(
        buildingLureTarget(
          "cannon",
          "blue",
          rotated.find((e) => e.id === balloon.id)!,
          rotated,
          (p) => p.x !== 9,
        ),
      ).toEqual({ x: 18 - point.x, y: 32 - point.y });
      expect(b.entities).toEqual(before);
    } finally {
      random.mockRestore();
    }
  });
});
