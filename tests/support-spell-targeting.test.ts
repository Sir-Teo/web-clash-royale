import { describe, expect, it, vi } from "vitest";
import { areaSpellTarget, isAreaSpell } from "../src/game/area-spell-targeting";
import {
  Battle,
  type AreaEffect,
  type Entity,
  type Projectile,
} from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { deploymentRadius } from "../src/game/deployment";
import { perspective, snapshot } from "../src/network/perspective";

function unit(id: number, card: CardId, extra: Partial<Entity> = {}): Entity {
  const c = CARD_MAP[card];
  return {
    id,
    card,
    team: "red",
    kind: c.kind as Entity["kind"],
    x: 4,
    y: 20,
    hp: c.hp,
    maxHp: c.hp,
    radius: deploymentRadius(card),
    air: !!c.air,
    damage: c.damage,
    range: c.range,
    interval: c.interval,
    speed: c.speed,
    age: 0,
    deploy: 0,
    stun: 0,
    attack: 0,
    move: 0,
    target: null,
    cooldown: 0,
    active: true,
    spawnTimer: 0,
    ...extra,
  };
}
const wounded = (
  id: number,
  card: CardId,
  fraction = 0.2,
  extra: Partial<Entity> = {},
) => unit(id, card, { hp: CARD_MAP[card].hp * fraction, ...extra });
function cloud(
  card: AreaEffect["card"],
  extra: Partial<AreaEffect> = {},
): AreaEffect {
  return {
    id: 90,
    card,
    team: "red",
    x: 4,
    y: 20,
    radius: CARD_MAP[card].radius!,
    remaining: 3,
    duration: 3.05,
    ...extra,
  };
}
function shot(entity: Entity, extra: Partial<Projectile> = {}): Projectile {
  return {
    id: 100,
    team: "blue",
    x: 9,
    y: 30,
    tx: entity.x,
    ty: entity.y,
    target: null,
    source: 0,
    damage: 1000,
    remaining: 0.1,
    duration: 1,
    splash: 2,
    air: true,
    style: "fireball",
    stun: 0,
    ...extra,
  };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();

describe("friendly Heal and Clone AI", () => {
  it("classifies both support spells without optimizing unrelated archive spells", () => {
    expect(isAreaSpell("heal")).toBe(true);
    expect(isAreaSpell("clone")).toBe(true);
    expect(isAreaSpell("lightning")).toBe(false);
  });

  it("heals a valuable injured group on the enemy half, below six elixir", () => {
    const b = new Battle({ ai: false });
    const friends = [
      wounded(50, "musketeer"),
      wounded(51, "musketeer", 0.2, { x: 5 }),
    ];
    b.entities.push(...friends);
    b.players.red.hand = ["heal", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 3;
    think(b);
    const action = b.actions.at(-1)!;
    expect(action).toMatchObject({ card: "heal", y: 20 });
    expect(Math.abs(action.x - 4.5)).toBeLessThanOrEqual(0.5);
    const before = friends.map((e) => e.hp);
    for (const e of friends) e.active = false;
    for (let i = 0; i < 15; i++) b.step();
    expect(friends.map((e) => e.hp)).toEqual(before.map((hp) => hp + 128));
  });

  it("ignores healthy, dead, enemy and structural health, including missing shields", () => {
    const b = new Battle({ ai: false });
    const guard = unit(50, "dark-prince", { maxShield: 200, shield: 0 });
    const invalid = [
      guard,
      unit(51, "wizard"),
      wounded(52, "wizard", 0),
      wounded(54, "wizard", 0.1, { team: "blue" }),
      wounded(55, "cannon", 0.1),
      ...b.entities.map((e) => ({ ...e, hp: 1 })),
    ];
    expect(areaSpellTarget("heal", "red", invalid)).toBeUndefined();
    expect(
      areaSpellTarget("heal", "red", [wounded(56, "wizard", 0.99)]),
    ).toBeUndefined();
  });

  it("reserves one existing healing stream and waits for useful additional restoration", () => {
    const wizard = wounded(50, "wizard", 0.2);
    expect(
      areaSpellTarget("heal", "red", [wizard], [cloud("heal")]),
    ).toBeUndefined();
    const short = cloud("heal", { remaining: 0.1 });
    expect(areaSpellTarget("heal", "red", [wizard], [short])).toBeDefined();
    expect(
      areaSpellTarget("heal", "red", [wizard], [short, { ...short, id: 91 }]),
    ).toEqual(areaSpellTarget("heal", "red", [wizard], [short]));
    expect(
      areaSpellTarget("heal", "red", [
        { ...wizard, heal: { remaining: 0.5, elapsed: 0.4 } },
      ])?.value,
    ).toBeLessThan(areaSpellTarget("heal", "red", [wizard])!.value);
  });

  it("rescues wounded troops during their deployment instead of waiting for them to attack", () => {
    const b = new Battle({ ai: false });
    const friends = [
      wounded(50, "musketeer", 0.2, { deploy: 2, active: false }),
      wounded(51, "musketeer", 0.2, { deploy: 2, active: false, x: 5 }),
    ];
    b.entities.push(...friends);
    b.players.red.hand = ["heal", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions.at(-1)?.card).toBe("heal");
    const before = friends.map((e) => e.hp);
    for (let i = 0; i < 15; i++) b.step();
    expect(friends.every((e) => e.deploy > 1)).toBe(true);
    expect(friends.map((e) => e.hp)).toEqual(before.map((hp) => hp + 128));
  });

  it("does not heal an imminent fatal blast, while shields still absorb a complete packet", () => {
    const wizard = wounded(50, "wizard", 0.2);
    const blast = shot(wizard);
    expect(
      areaSpellTarget("heal", "red", [wizard], [], [blast]),
    ).toBeUndefined();
    const protectedWizard = { ...wizard, shield: 10, maxShield: 10 };
    expect(
      areaSpellTarget("heal", "red", [protectedWizard], [], [blast]),
    ).toBeDefined();
    expect(
      areaSpellTarget(
        "heal",
        "red",
        [protectedWizard],
        [],
        [blast, { ...blast, id: 101, remaining: 0.2 }],
      ),
    ).toBeUndefined();
  });

  it("accounts for Mirror's surcharge rather than buying a marginal copied Heal", () => {
    const wizard = wounded(50, "wizard", 0.45);
    const normal = areaSpellTarget("heal", "red", [wizard]);
    expect(normal).toBeDefined();
    expect(areaSpellTarget("heal", "red", [wizard], [], [], 4)).toBeUndefined();
    const b = new Battle({ ai: false });
    b.entities.push(wizard);
    b.players.red.hand = ["mirror", "pekka", "pekka", "pekka"];
    b.players.red.lastPlayed = "heal";
    b.players.red.elixir = 4;
    think(b);
    expect(b.actions).toHaveLength(0);
    wizard.hp = 1;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({ card: "mirror", y: 20 });
    expect(b.areas.at(-1)?.card).toBe("heal");
    expect(b.players.red.elixir).toBe(0);
  });

  it("does not spend Heal before a fatal Poison tick and orders shield packets correctly", () => {
    const wizard = unit(50, "wizard", {
      hp: 50,
      poison: { remaining: 0.8, elapsed: 0.8 },
    });
    expect(areaSpellTarget("heal", "red", [wizard])).toBeUndefined();
    const shielded = { ...wizard, shield: 10, maxShield: 10 };
    expect(areaSpellTarget("heal", "red", [shielded])).toBeDefined();
    expect(
      areaSpellTarget(
        "heal",
        "red",
        [shielded],
        [],
        [shot(shielded, { remaining: 0.3 })],
      ),
    ).toBeUndefined();
    // The existing Heal's next tick arrives before Poison, buying useful time.
    expect(
      areaSpellTarget("heal", "red", [
        { ...wizard, heal: { remaining: 0.3, elapsed: 0.4 } },
      ]),
    ).toBeDefined();
    expect(
      areaSpellTarget("heal", "red", [
        { ...wizard, poison: { remaining: 0.1, elapsed: 0.1 } },
      ]),
    ).toBeDefined();
  });

  it("clones a ground/air push instead of aiming at a distant enemy group", () => {
    const b = new Battle({ ai: false });
    b.entities.push(
      unit(50, "giant"),
      unit(51, "baby-dragon", { x: 5 }),
      unit(52, "witch", { team: "blue", x: 14, y: 10 }),
    );
    b.players.red.hand = ["clone", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({ card: "clone", y: 20 });
    b.step();
    const copies = b.entities.filter((e) => e.clone);
    expect(copies.map((e) => e.card)).toEqual(["giant", "baby-dragon"]);
    expect(copies.every((e) => e.hp === 1 && e.maxHp === 1 && !e.shield)).toBe(
      true,
    );
  });

  it("waits for a useful push, ignores copied bodies and never clones structures", () => {
    expect(
      areaSpellTarget("clone", "red", [unit(50, "pekka", { y: 4 })]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("clone", "red", [
        unit(50, "pekka", { clone: true, hp: 1, maxHp: 1 }),
      ]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("clone", "red", [
        unit(50, "cannon"),
        unit(51, "pekka", { team: "blue" }),
      ]),
    ).toBeUndefined();
    const defender = unit(50, "pekka", { y: 10 });
    expect(
      areaSpellTarget("clone", "red", [
        defender,
        unit(51, "giant", { team: "blue", y: 11 }),
      ]),
    ).toBeDefined();
  });

  it("waits for active Clone coverage, including originals that have moved out", () => {
    const push = unit(50, "pekka");
    expect(
      areaSpellTarget("clone", "red", [push], [cloud("clone")]),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "clone",
        "red",
        [push],
        [cloud("clone", { x: 14, y: 4, struck: [50] })],
      ),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "clone",
        "red",
        [push],
        [cloud("clone", { remaining: 0 })],
      ),
    ).toBeDefined();
  });

  it("can copy a forward deployment using the copy's own readiness delay", () => {
    const b = new Battle({ ai: false });
    const original = unit(50, "pekka", { deploy: 2 });
    b.entities.push(original);
    b.players.red.hand = ["clone", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions.at(-1)?.card).toBe("clone");
    b.step();
    const copy = b.entities.find((e) => e.clone)!;
    expect(copy.hp).toBe(1);
    expect(copy.deploy).toBeLessThan(original.deploy);
    expect(original.deploy).toBeGreaterThan(1.9);
  });

  it("avoids persistent damage, long Freeze and inherited Poison that would erase the copies", () => {
    const push = unit(50, "pekka");
    for (const card of ["poison", "tornado", "freeze"] as const)
      expect(
        areaSpellTarget(
          "clone",
          "red",
          [push],
          [cloud(card, { team: "blue" })],
        ),
      ).toBeUndefined();
    expect(
      areaSpellTarget("clone", "red", [
        { ...push, poison: { remaining: 0.8, elapsed: 0.5 } },
      ]),
    ).toBeUndefined();
    expect(
      areaSpellTarget("clone", "red", [
        { ...push, poison: { remaining: 0.1, elapsed: 0.1 } },
      ]),
    ).toBeDefined();
    expect(
      areaSpellTarget("clone", "red", [{ ...push, stun: 2 }]),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "clone",
        "red",
        [push],
        [cloud("freeze", { team: "red" })],
      ),
    ).toBeDefined();
  });

  it("respects splash counters, attack layers and Freeze protection", () => {
    const push = unit(50, "pekka");
    const wizard = unit(51, "wizard", { team: "blue", y: 21 });
    expect(areaSpellTarget("clone", "red", [push, wizard])).toBeUndefined();
    expect(
      areaSpellTarget("clone", "red", [push, wizard], [cloud("freeze")]),
    ).toBeDefined();
    expect(
      areaSpellTarget("clone", "red", [push, { ...wizard, card: "bowler" }]),
    ).toBeUndefined();
    const flyers = [0, 1, 2].map((i) =>
      unit(55 + i, "minions", { x: 4 + i * 0.1 }),
    );
    expect(
      areaSpellTarget("clone", "red", [
        ...flyers,
        unit(60, "bomber", { team: "blue", y: 21 }),
      ]),
    ).toBeDefined();
  });

  it("does not create one-hitpoint copies in an incoming area blast or copy the original shield", () => {
    const push = unit(50, "dark-prince", { shield: 200, maxShield: 200 });
    const blast = shot(push);
    expect(
      areaSpellTarget("clone", "red", [push], [], [blast]),
    ).toBeUndefined();
    expect(
      areaSpellTarget(
        "clone",
        "red",
        [push],
        [],
        [{ ...blast, splash: 0, target: push.id }],
      ),
    ).toBeDefined();
  });

  it("considers Clone's actual separation when only one side can survive a damage cloud", () => {
    const b = new Battle({ ai: false });
    for (const tower of b.entities) tower.active = false;
    const originals = [
      unit(50, "pekka", { active: false }),
      unit(51, "pekka", { x: 4.1, active: false }),
    ];
    b.entities.push(...originals);
    const poison = cloud("poison", {
      team: "blue",
      y: 20.65,
      remaining: 8,
      duration: 8,
      x: 4 + 0.25 + CARD_MAP.poison.radius! + originals[0].radius - 0.05,
    });
    b.areas.push(poison);
    b.players.red.hand = ["clone", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 3;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({ card: "clone", x: 4.1 });
    for (let i = 0; i < 45; i++) b.step();
    const livingCopies = b.entities.filter((e) => e.clone && e.hp > 0);
    expect(livingCopies).toHaveLength(1);
    expect(livingCopies[0].x).toBeLessThan(4);
  });

  it("avoids an original about to inherit Poison even if the copy would be outside its radius", () => {
    const b = new Battle({ ai: false });
    const original = unit(50, "pekka", { x: 9 });
    b.entities.push(original);
    b.areas.push(
      cloud("poison", {
        team: "blue",
        remaining: 8,
        duration: 8,
        x: original.x - CARD_MAP.poison.radius! - original.radius + 0.05,
      }),
    );
    expect(
      areaSpellTarget("clone", "red", b.entities, b.areas),
    ).toBeUndefined();
    // The real update order confirms why a visually clear copy is unsafe.
    b.players.red.hand[0] = "clone";
    b.players.red.elixir = 3;
    expect(b.play("red", 0, original.x, original.y).ok).toBe(true);
    b.step();
    expect(b.entities.find((e) => e.clone)?.poison).toBeDefined();
  });

  it("keeps both support targets pure, legal and consistent in the opposite perspective", () => {
    const b = new Battle({ ai: false });
    b.entities = [
      wounded(50, "wizard", 0.1),
      wounded(51, "musketeer", 0.1, { x: 5 }),
    ];
    const original = structuredClone(b.entities);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("RNG draw");
    });
    try {
      for (const card of ["heal", "clone"] as const) {
        const plan = areaSpellTarget(card, "red", b.entities)!;
        const reversed = perspective(snapshot(b), "red");
        expect(areaSpellTarget(card, "blue", reversed.entities)).toMatchObject({
          x: 18 - plan.x,
          y: 32 - plan.y,
        });
        expect(b.canPlace("red", card, plan.x, plan.y).ok).toBe(true);
      }
      expect(b.entities).toEqual(original);
    } finally {
      random.mockRestore();
    }
  });

  for (const card of ["heal", "clone"] as const)
    it(`uses ${card} in a natural battle and reproduces its complete outcome from commands`, () => {
      const enemyDeck: CardId[] =
        card === "clone"
          ? [
              "clone",
              "giant",
              "musketeer",
              "witch",
              "minions",
              "knight",
              "zap",
              "fireball",
            ]
          : [
              "heal",
              "musketeer",
              "three-musketeers",
              "giant",
              "knight",
              "skeletons",
              "zap",
              "fireball",
            ];
      const battle = new Battle({ seed: 1, enemyDeck });
      while (!battle.winner) {
        // All setup and damage come from ordinary legal commands. No entities,
        // hands, resources or clocks are modified after Battle construction.
        if (card === "heal" && battle.tick % 30 === 0) {
          const hand = battle.players.blue.hand;
          const target = battle.entities.find(
            (e) =>
              e.team === "red" &&
              e.card === "musketeer" &&
              e.deploy <= 0 &&
              e.hp > e.maxHp * 0.9,
          );
          const slot = hand.indexOf("fireball");
          if (target && slot >= 0 && battle.players.blue.elixir >= 4)
            battle.play("blue", slot, target.x, target.y);
          else if (slot < 0) {
            const cycle = hand.findIndex(
              (id) =>
                CARD_MAP[id].kind === "troop" &&
                CARD_MAP[id].cost <= battle.players.blue.elixir,
            );
            if (cycle >= 0) battle.play("blue", cycle, 9, 24);
          }
        }
        battle.step();
        expect(battle.players.red.elixir).toBeGreaterThanOrEqual(0);
        expect(battle.tick).toBeLessThanOrEqual(9000);
      }
      expect(
        battle.actions.some(
          (action) => action.team === "red" && action.card === card,
        ),
      ).toBe(true);
      const replay = new Battle({ replay: battle.exportReplay() });
      while (replay.tick < battle.tick) replay.step();
      expect(snapshot(replay)).toEqual(snapshot(battle));
      expect(replay.audioEvents).toEqual(battle.audioEvents);
      expect(replay.exportReplay()).toMatchObject({
        version: 20,
        rulesFamily: "origin",
      });
    });
});
