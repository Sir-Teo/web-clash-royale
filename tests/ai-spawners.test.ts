import { expect, it, vi } from "vitest";
import { Battle, type Projectile } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { spawnerPlan } from "../src/game/spawner-targeting";
import { perspective, snapshot } from "../src/network/perspective";

const deck: CardId[] = [
  "goblin-hut",
  "barbarian-hut",
  "furnace",
  "knight",
  "mirror",
  "rocket",
  "golem",
  "musketeer",
];
function setup(card: CardId = "barbarian-hut", elixir = 6) {
  const battle = new Battle({ seed: 12, ai: false, enemyDeck: deck });
  battle.players.red.hand = [card, "knight", "golem", "musketeer"];
  battle.players.red.elixir = elixir;
  return battle;
}
function context(battle: Battle) {
  return {
    team: "red" as const,
    cards: battle.players.red.hand.map((id) => ({
      id,
      played: battle.cardForPlay("red", id) ?? id,
      cost: battle.cardCost("red", id),
    })),
    remaining: 180,
    overtime: false,
    entities: battle.entities,
    projectiles: battle.projectiles,
    areas: battle.areas,
    legal: (card: CardId, point: { x: number; y: number }) =>
      battle.canPlace("red", card, point.x, point.y).ok,
  };
}
const think = (battle: Battle) => (battle as any).think();
const unit = (
  battle: Battle,
  card: CardId,
  team: "blue" | "red",
  x: number,
  y: number,
) => {
  (battle as any).spawn(card, team, x, y);
  return battle.entities.at(-1)!;
};

it("saves for Barbarian Hut instead of cycling every cheap card at six elixir", () => {
  const battle = setup();
  expect(spawnerPlan(context(battle))).toMatchObject({
    id: "barbarian-hut",
    requiredElixir: 9,
    point: { x: 9, y: 10 },
  });
  think(battle);
  expect(battle.actions).toEqual([]);
  expect(battle.players.red.elixir).toBe(6);
  battle.players.red.elixir = 9;
  think(battle);
  expect(battle.actions[0]).toMatchObject({
    card: "barbarian-hut",
    x: 9,
    y: 10,
  });
  expect(battle.players.red.elixir).toBe(2);
  for (let i = 0; i < 50; i++) battle.step();
  expect(
    battle.entities.filter(
      (entity) => entity.team === "red" && entity.card === "barbarians",
    ),
  ).toHaveLength(2);
});

it.each([
  ["goblin-hut", 7, "spear-goblins", 1],
  ["furnace", 6, "fire-spirits", 2],
] as const)(
  "funds %s and produces real children after deployment",
  (card, budget, child, count) => {
    const battle = setup(card, budget);
    think(battle);
    expect(battle.actions[0]).toMatchObject({ card, x: 9, y: 10 });
    expect(battle.players.red.elixir).toBe(2);
    for (let i = 0; i < 50; i++) battle.step();
    expect(
      battle.entities.filter(
        (entity) => entity.team === "red" && entity.card === child,
      ),
    ).toHaveLength(count);
  },
);

it("keeps the reserve affordability tolerance when a hut becomes funded", () => {
  const below = setup("goblin-hut", 7 - 1.1e-6);
  think(below);
  expect(below.actions).toEqual([]);
  const ready = setup("goblin-hut", 7 - 0.9e-6);
  think(ready);
  expect(ready.actions[0].card).toBe("goblin-hut");
});

it("drops the savings plan for an approaching push and plays a real defender", () => {
  const battle = setup();
  think(battle);
  expect(battle.actions).toEqual([]);
  const attacker = unit(battle, "knight", "blue", 4, 10);
  attacker.deploy = 0;
  expect(spawnerPlan(context(battle))).toBeUndefined();
  think(battle);
  expect(battle.actions[0].card).toBe("knight");
  expect(battle.players.red.elixir).toBe(3);
});

it("does not save instead of casting a known King finisher", () => {
  const battle = setup();
  battle.players.red.hand = [
    "barbarian-hut",
    "rocket",
    "golem",
    "three-musketeers",
  ];
  battle.entities.find((entity) => entity.team === "blue" && entity.king)!.hp =
    20;
  think(battle);
  expect(battle.actions[0].card).toBe("rocket");
});

it("allows a ready Collector investment before waiting for a more expensive hut", () => {
  const battle = setup("barbarian-hut", 8);
  battle.players.red.hand = [
    "barbarian-hut",
    "elixir-collector",
    "knight",
    "rage",
  ];
  think(battle);
  expect(battle.actions[0].card).toBe("elixir-collector");
  expect(battle.players.red.elixir).toBe(2);
});

it("chooses the cheaper viable hut and leaves the input hand in its recorded order", () => {
  const battle = setup();
  battle.players.red.hand = [
    "barbarian-hut",
    "goblin-hut",
    "furnace",
    "knight",
  ];
  const input = context(battle),
    before = structuredClone(input.cards);
  expect(spawnerPlan(input)).toMatchObject({
    id: "furnace",
    requiredElixir: 6,
  });
  expect(input.cards).toEqual(before);
});

it("avoids a same-card duplicate but permits another kind of hut and replacing a destroyed one", () => {
  const battle = setup();
  battle.players.red.hand = ["furnace", "goblin-hut", "knight", "golem"];
  const furnace = unit(battle, "furnace", "red", 9, 10);
  expect(furnace.deploy).toBeGreaterThan(0);
  expect(spawnerPlan(context(battle))).toMatchObject({
    id: "goblin-hut",
    point: { x: 6.5, y: 10 },
  });
  furnace.hp = 0;
  expect(spawnerPlan(context(battle))).toMatchObject({
    id: "furnace",
    point: { x: 9, y: 10 },
  });
});

it("does not turn Tombstone, defensive towers or Collector into quiet reinforcement plans", () => {
  const battle = setup();
  battle.players.red.hand = [
    "tombstone",
    "cannon",
    "inferno-tower",
    "elixir-collector",
  ];
  expect(spawnerPlan(context(battle))).toBeUndefined();
  battle.players.red.elixir = 3;
  unit(battle, "hog-rider", "blue", 14, 12).deploy = 0;
  think(battle);
  expect(battle.actions[0]).toMatchObject({ card: "tombstone", x: 9, y: 10 });
});

it("stops quiet investment late or in sudden death while retaining ordinary offense", () => {
  const battle = setup(),
    input = context(battle);
  expect(spawnerPlan({ ...input, remaining: 30 })).toBeDefined();
  expect(spawnerPlan({ ...input, remaining: 29.99 })).toBeUndefined();
  expect(spawnerPlan({ ...input, overtime: true })).toBeUndefined();
  battle.tick = 153 * 30;
  think(battle);
  expect(battle.actions[0].card).toBe("knight");
});

it("checks the far river bank before a push crosses and ignores dead enemies", () => {
  const battle = setup(),
    enemy = unit(battle, "balloon", "blue", 4, 18);
  expect(spawnerPlan(context(battle))).toBeUndefined();
  enemy.hp = 0;
  expect(spawnerPlan(context(battle))).toBeDefined();
});

it("searches legal neighboring positions and does not save forever for an unavailable site", () => {
  const battle = setup(),
    input = context(battle);
  expect(
    spawnerPlan({
      ...input,
      legal: (_, point) => point.x !== 9 && input.legal("barbarian-hut", point),
    }),
  ).toMatchObject({ point: { x: 6.5, y: 10 } });
  expect(spawnerPlan({ ...input, legal: () => false })).toBeUndefined();
});

it("avoids known incoming splash and active hostile areas without rejecting harmless effects", () => {
  const battle = setup();
  const rocket: Projectile = {
    id: 100,
    team: "blue",
    x: 9,
    y: 29,
    tx: 9,
    ty: 10,
    target: null,
    damage: 1484,
    remaining: 1,
    duration: 3,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
  };
  battle.projectiles.push(rocket);
  const alternate = spawnerPlan(context(battle))!;
  expect(
    Math.hypot(alternate.point.x - 9, alternate.point.y - 10),
  ).toBeGreaterThan(2);
  rocket.team = "red";
  expect(spawnerPlan(context(battle))).toMatchObject({
    point: { x: 9, y: 10 },
  });
  battle.areas.push({
    id: 101,
    team: "blue",
    card: "poison",
    x: 9,
    y: 10,
    radius: 10,
    duration: 8,
    remaining: 8,
  });
  expect(spawnerPlan(context(battle))).toBeUndefined();
  battle.areas[0].card = "rage";
  expect(spawnerPlan(context(battle))).toBeDefined();
});

it("uses Mirror's real cost for planning and leaves two elixir after its accepted command", () => {
  const battle = setup("mirror", 9);
  battle.players.red.lastPlayed = "barbarian-hut";
  expect(spawnerPlan(context(battle))).toMatchObject({
    id: "mirror",
    card: "barbarian-hut",
    requiredElixir: 10,
  });
  think(battle);
  expect(battle.actions).toEqual([]);
  battle.players.red.elixir = 10;
  think(battle);
  expect(battle.actions[0].card).toBe("mirror");
  expect(battle.players.red.elixir).toBe(2);
  expect(battle.entities.at(-1)!.card).toBe("barbarian-hut");
});

it("mirrors the plan exactly without mutating game state or consuming RNG", () => {
  const battle = setup();
  unit(battle, "cannon", "red", 9, 10);
  const before = snapshot(battle),
    rng = vi.spyOn(battle, "random");
  const point = spawnerPlan(context(battle))!;
  const rotated = perspective(before, "red");
  expect(
    spawnerPlan({
      ...context(battle),
      team: "blue",
      entities: rotated.entities,
      projectiles: rotated.projectiles,
      areas: rotated.areas ?? [],
      legal: (card, candidate) =>
        battle.canPlace("red", card, 18 - candidate.x, 32 - candidate.y).ok,
    }),
  ).toEqual({
    ...point,
    point: { x: 18 - point.point.x, y: 32 - point.point.y },
  });
  expect(snapshot(battle)).toEqual(before);
  expect(rng).not.toHaveBeenCalled();
});

it.each(["Village Warden", "Royal Cannoneer"])(
  "%s deploys its actual reinforcement cards and replays the opening exactly",
  (name) => {
    const opponent = SOLO_OPPONENTS.find((opponent) => opponent.name === name)!;
    const live = new Battle({ seed: 12, ai: true, enemyDeck: opponent.deck });
    for (let tick = 0; tick < 1200 && !live.winner; tick++) live.step();
    const reinforcement = live.actions.filter((action) =>
      ["goblin-hut", "barbarian-hut", "furnace"].includes(action.card),
    );
    expect(reinforcement).toHaveLength(name === "Village Warden" ? 2 : 1);
    if (name === "Village Warden")
      expect(reinforcement.map((action) => action.card)).toEqual([
        "goblin-hut",
        "barbarian-hut",
      ]);
    else expect(reinforcement[0].card).toBe("furnace");
    const replay = live.exportReplay(),
      rebuilt = new Battle({ replay });
    while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
    expect(rebuilt.entities).toEqual(live.entities);
    expect(rebuilt.players).toEqual(live.players);
    expect(rebuilt.projectiles).toEqual(live.projectiles);
    expect(rebuilt.areas).toEqual(live.areas);
    expect(rebuilt.audioEvents).toEqual(live.audioEvents);
    expect(rebuilt.actions).toEqual(live.actions);
    expect(rebuilt.winner).toBe(live.winner);
  },
);
