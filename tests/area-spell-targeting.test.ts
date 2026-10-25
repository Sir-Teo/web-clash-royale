import { describe, expect, it, vi } from "vitest";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { Battle, type AreaEffect, type Entity } from "../src/game/engine";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import {
  damageSpellTarget,
  pendingSpellDamage,
} from "../src/game/spell-targeting";
import { perspective, snapshot } from "../src/network/perspective";

function unit(
  id: number,
  card: CardId,
  x: number,
  y: number,
  extra: Partial<Entity> = {},
): Entity {
  const c = CARD_MAP[card];
  return {
    id,
    card,
    kind: c.kind as Entity["kind"],
    team: "red",
    x,
    y,
    hp: c.hp,
    maxHp: c.hp,
    radius: 0.45,
    air: !!c.air,
    damage: c.damage,
    range: c.range,
    cooldown: 0,
    interval: c.interval,
    speed: c.speed,
    target: null,
    age: 0,
    deploy: 0,
    stun: 0,
    attack: 0,
    move: 0,
    active: true,
    spawnTimer: 0,
    ...extra,
  };
}
function cloud(
  card: AreaEffect["card"],
  x: number,
  y: number,
  extra: Partial<AreaEffect> = {},
): AreaEffect {
  return {
    id: 99,
    team: "red",
    card,
    x,
    y,
    radius: CARD_MAP[card].radius!,
    remaining: 6,
    duration: 6,
    ...extra,
  };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();

describe("AI persistent area spell targets", () => {
  it("boosts an advancing push below six elixir without needing an enemy on its own side", () => {
    const b = new Battle({ seed: 4, ai: false });
    b.entities.push(unit(10, "giant", 4, 20));
    b.players.red.hand = ["rage", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 2;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({ card: "rage", x: 4, y: 20 });
    b.step();
    expect(b.entities.find((e) => e.id === 10)?.rage).toBeDefined();
  });
  it("waits for a deployment or a push to advance, and counts a swarm per body", () => {
    expect(
      areaSpellTarget("rage", "red", [unit(10, "giant", 4, 3)]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("rage", "red", [unit(10, "giant", 4, 20, { deploy: 1 })]),
    ).toBeUndefined();
    const army = Array.from({ length: 15 }, (_, i) =>
      unit(10 + i, "skeleton-army", 4 + (i % 3) * 0.2, 20),
    );
    expect(areaSpellTarget("rage", "red", army)).toBeUndefined();
    expect(
      areaSpellTarget("rage", "red", [...army, unit(30, "prince", 4, 20)]),
    ).toBeDefined();
  });
  it("does not recast Rage over an existing area or boost, or into an enemy Freeze", () => {
    const giant = unit(10, "giant", 4, 20);
    expect(
      areaSpellTarget("rage", "red", [giant], [cloud("rage", 4, 20)]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("rage", "red", [{ ...giant, rage: { remaining: 1 } }]),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "rage",
        "red",
        [giant],
        [cloud("freeze", 4, 20, { team: "blue" })],
      ),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "rage",
        "red",
        [giant],
        [cloud("rage", 4, 20, { remaining: 0.1 })],
      ),
    ).toBeDefined();
  });
  it("boosts engaged friendly troops while excluding buildings and Crown Towers", () => {
    const b = new Battle({ ai: false });
    const king = b.entities.find((e) => e.team === "red" && e.king)!;
    expect(areaSpellTarget("rage", "red", [king])).toBeUndefined();
    const tower = b.entities.find((e) => e.team === "red" && !e.king)!;
    const cannon = unit(10, "cannon", tower.x + 1, tower.y);
    const attacker = unit(11, "giant", tower.x, tower.y + 2, { team: "blue" });
    expect(
      areaSpellTarget("rage", "red", [tower, cannon, attacker]),
    ).toBeUndefined();
    const defender = unit(12, "pekka", tower.x, tower.y);
    expect(areaSpellTarget("rage", "red", [defender, attacker])).toBeDefined();
    expect(areaSpellTarget("rage", "red", [cannon, attacker])).toBeUndefined();
  });
  it("freezes a defender only when a meaningful friendly fight can benefit", () => {
    const wizard = unit(10, "wizard", 4, 20, { team: "blue" });
    expect(areaSpellTarget("freeze", "red", [wizard])).toBeUndefined();
    const balloon = unit(11, "balloon", 4, 21);
    expect(areaSpellTarget("freeze", "red", [wizard, balloon])).toBeDefined();
    expect(
      areaSpellTarget("freeze", "red", [wizard, { ...balloon, y: 10 }]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("freeze", "red", [wizard, { ...balloon, hp: 1 }]),
    ).toBeUndefined();
  });
  it("supports friendly swarms together and excludes harmless air counters", () => {
    const wizard = unit(10, "wizard", 4, 20, { team: "blue" });
    const minions = Array.from({ length: 3 }, (_, i) =>
      unit(11 + i, "minions", 4 + i * 0.1, 21),
    );
    expect(
      areaSpellTarget("freeze", "red", [wizard, ...minions]),
    ).toBeDefined();
    expect(
      areaSpellTarget("freeze", "red", [
        unit(10, "cannon", 4, 20, { team: "blue" }),
        unit(11, "balloon", 4, 21),
      ]),
    ).toBeUndefined();
  });
  it("does not refreeze covered enemies and includes a hidden Tesla that threatens a push", () => {
    const tesla = unit(10, "tesla", 4, 20, {
        team: "blue",
        burrow: { phase: "hidden", exposure: 0, idle: 0 },
      }),
      balloon = unit(11, "balloon", 4, 21);
    expect(areaSpellTarget("freeze", "red", [tesla, balloon])).toBeDefined();
    expect(
      areaSpellTarget(
        "freeze",
        "red",
        [tesla, balloon],
        [cloud("freeze", 4, 20)],
      ),
    ).toBeUndefined();
    expect(
      areaSpellTarget("freeze", "red", [{ ...tesla, stun: 1 }, balloon]),
    ).toBeUndefined();
    expect(areaSpellTarget("poison", "red", [tesla])).toBeUndefined();
  });
  it("values Poison against a far-side group and avoids isolated low-value targets", () => {
    const wizard = unit(10, "wizard", 4, 23, { team: "blue" }),
      witch = unit(11, "witch", 5, 23, { team: "blue" });
    expect(areaSpellTarget("poison", "red", [wizard, witch])).toBeDefined();
    expect(
      areaSpellTarget("poison", "red", [
        unit(10, "skeletons", 4, 23, { team: "blue" }),
      ]),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "poison",
        "red",
        [wizard, witch],
        [cloud("poison", 4, 23)],
      ),
    ).toBeUndefined();
  });
  it("projects Poison's tower damage, including a lethal King, and prefers a faster direct finisher", () => {
    const b = new Battle({ seed: 2, ai: false });
    const target = b.entities.find((e) => e.team === "blue" && !e.king)!;
    target.hp = 300;
    expect(areaSpellTarget("poison", "red", [target])?.lethalTower).toBe(
      target.id,
    );
    target.hp = 400;
    expect(areaSpellTarget("poison", "red", [target])).toBeUndefined();
    const king = b.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 100;
    expect(areaSpellTarget("poison", "red", [target, king])?.lethalTower).toBe(
      king.id,
    );
    king.hp = king.maxHp;
    target.hp = 100;
    b.players.red.hand = ["poison", "fireball", "pekka", "pekka"];
    b.players.red.elixir = 4;
    think(b);
    expect(b.actions.at(-1)?.card).toBe("fireball");
  });
  it("reserves overlapping Poison damage once for stationary targets and spares a redundant finisher", () => {
    const b = new Battle({ ai: false });
    const target = b.entities.find((e) => e.team === "blue" && !e.king)!;
    target.hp = 100;
    const areas = [
      cloud("poison", target.x, target.y, { remaining: 4 }),
      cloud("poison", target.x, target.y, { remaining: 2 }),
    ];
    expect(pendingSpellDamage(target, "red", [], areas)).toBeCloseTo(
      4 * 121 * 0.4,
    );
    expect(
      damageSpellTarget("fireball", "red", [target], [], areas),
    ).toBeUndefined();
    b.areas = areas;
    b.players.red.hand = ["fireball", "poison", "pekka", "pekka"];
    b.players.red.elixir = 4;
    const before = b.actions.length;
    think(b);
    expect(b.actions).toHaveLength(before);
    expect(
      pendingSpellDamage({ ...target, team: "red" }, "blue", [], areas),
    ).toBe(0);
  });
  it("does not count a Poison overlap as extra damage from a newly placed cloud", () => {
    const b = new Battle({ ai: false }),
      target = b.entities.find((e) => e.team === "blue" && !e.king)!;
    target.hp = 500;
    expect(
      areaSpellTarget(
        "poison",
        "red",
        [target],
        [cloud("poison", target.x, target.y, { remaining: 0.4 })],
      ),
    ).toBeUndefined();
  });
  it("keeps area target selection pure, legal and equivalent in the opposite perspective", () => {
    const b = new Battle({ ai: false });
    b.entities = [unit(10, "giant", 4, 20), unit(11, "witch", 5, 20)];
    const original = structuredClone(b.entities),
      plan = areaSpellTarget("rage", "red", b.entities)!;
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random draw");
    });
    try {
      const view = perspective(snapshot(b), "red");
      expect(areaSpellTarget("rage", "blue", view.entities)).toMatchObject({
        x: 18 - plan.x,
        y: 32 - plan.y,
      });
      expect(b.entities).toEqual(original);
      expect(b.canPlace("red", "rage", plan.x, plan.y).ok).toBe(true);
    } finally {
      random.mockRestore();
    }
  });
});
