import { expect, it, vi } from "vitest";
import { Battle, type AreaEffect, type Projectile } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { collectorTarget } from "../src/game/collector-targeting";
import { perspective, snapshot } from "../src/network/perspective";

const deck: CardId[] = [
  "elixir-collector",
  "knight",
  "musketeer",
  "golem",
  "mirror",
  "freeze",
  "arrows",
  "lightning",
];
function setup() {
  const battle = new Battle({ seed: 1, ai: false, deck, enemyDeck: deck });
  battle.players.red.hand = [
    "elixir-collector",
    "knight",
    "golem",
    "musketeer",
  ];
  battle.players.red.elixir = 8;
  return battle;
}
function context(battle: Battle) {
  return {
    team: "red" as const,
    elixir: battle.players.red.elixir,
    cost: 6,
    remaining: 180,
    overtime: false,
    entities: battle.entities,
    projectiles: battle.projectiles,
    areas: battle.areas,
    legal: (point: { x: number; y: number }) =>
      battle.canPlace("red", "elixir-collector", point.x, point.y).ok,
  };
}
const think = (battle: Battle) => (battle as any).think();
const blast = (team: "blue" | "red", x: number, y: number): Projectile => ({
  id: 100,
  team,
  x: 9,
  y: 29,
  tx: x,
  ty: y,
  target: null,
  damage: 1484,
  remaining: 1,
  duration: 5,
  splash: 2,
  air: true,
  style: "rocket",
  stun: 0,
  source: 0,
});
const cloud = (
  card: AreaEffect["card"],
  team: "blue" | "red",
  x: number,
  y: number,
): AreaEffect => ({
  id: 100,
  card,
  team,
  x,
  y,
  radius: 3.5,
  remaining: 8,
  duration: 8,
});

it("invests on a quiet field while keeping two elixir and a legal rear placement", () => {
  const battle = setup();
  think(battle);
  expect(battle.actions).toHaveLength(1);
  expect(battle.actions[0]).toMatchObject({ card: "elixir-collector", y: 1.5 });
  expect(battle.actions[0].x).toBe(1.5);
  expect(battle.players.red.elixir).toBe(2);
  expect(
    battle.entities.find((entity) => entity.card === "elixir-collector"),
  ).toMatchObject({
    team: "red",
    x: 1.5,
    y: 1.5,
    deploy: 1,
  });
});

it("requires the reserve with the same affordability tolerance as card commands", () => {
  const battle = setup(),
    input = context(battle);
  expect(collectorTarget({ ...input, elixir: 7 })).toBeUndefined();
  expect(collectorTarget({ ...input, elixir: 8 - 1.1e-6 })).toBeUndefined();
  expect(collectorTarget({ ...input, elixir: 8 - 0.9e-6 })).toBeDefined();
  expect(collectorTarget({ ...input, cost: 7, elixir: 8 })).toBeUndefined();
  expect(collectorTarget({ ...input, cost: 7, elixir: 9 })).toBeDefined();
});

it("saves elixir late in regulation and throughout sudden death", () => {
  const input = context(setup());
  expect(collectorTarget({ ...input, remaining: 70 })).toBeDefined();
  expect(collectorTarget({ ...input, remaining: 69.99 })).toBeUndefined();
  expect(
    collectorTarget({ ...input, remaining: 120, overtime: true }),
  ).toBeUndefined();
});

it("does not stack living or deploying Collectors and can replace a destroyed one", () => {
  const battle = setup();
  think(battle);
  expect(collectorTarget(context(battle))).toBeUndefined();
  battle.players.red.elixir = 10;
  const pump = battle.entities.find(
    (entity) => entity.card === "elixir-collector",
  )!;
  expect(pump.deploy).toBeGreaterThan(0);
  expect(collectorTarget(context(battle))).toBeUndefined();
  pump.hp = 0;
  expect(collectorTarget(context(battle))).toBeDefined();
});

it("keeps a real defender ahead of the Collector under ground pressure", () => {
  const battle = setup();
  (battle as any).spawn("knight", "blue", 4, 10);
  const attacker = battle.entities.at(-1)!;
  attacker.deploy = 0;
  battle.players.red.hand = ["elixir-collector", "knight", "golem", "giant"];
  think(battle);
  expect(battle.actions).toHaveLength(1);
  expect(battle.actions[0].card).toBe("knight");
  expect(
    Math.hypot(
      battle.actions[0].x - attacker.x,
      battle.actions[0].y - attacker.y,
    ),
  ).toBeLessThan(2);
});

it.each(["knight", "balloon"] as const)(
  "holds its only affordable Collector against %s",
  (card) => {
    const battle = setup();
    (battle as any).spawn(card, "blue", 14, 12);
    battle.entities.at(-1)!.deploy = 0;
    battle.players.red.hand = [
      "elixir-collector",
      "golem",
      "three-musketeers",
      "pekka",
    ];
    battle.players.red.elixir = 6;
    think(battle);
    expect(battle.actions).toEqual([]);
    expect(battle.players.red.elixir).toBe(6);
  },
);

it("waits for a push at the river before it crosses, ignoring dead enemies", () => {
  const battle = setup();
  (battle as any).spawn("giant", "blue", 4, 18);
  const attacker = battle.entities.at(-1)!;
  expect(collectorTarget(context(battle))).toBeUndefined();
  attacker.y = 18.01;
  expect(collectorTarget(context(battle))).toBeDefined();
  attacker.y = 12;
  attacker.hp = 0;
  expect(collectorTarget(context(battle))).toBeDefined();
});

it("searches another safe legal rear position and refuses an entirely blocked rear", () => {
  const input = context(setup());
  const first = collectorTarget(input)!;
  const next = collectorTarget({
    ...input,
    legal: (point) => point.x !== first.x && input.legal(point),
  })!;
  expect(next).toEqual({ x: 16.5, y: 1.5 });
  expect(collectorTarget({ ...input, legal: () => false })).toBeUndefined();
});

it("avoids incoming enemy blasts without treating friendly or decorative flights as danger", () => {
  const battle = setup(),
    first = collectorTarget(context(battle))!;
  battle.projectiles.push(blast("blue", first.x, first.y));
  expect(collectorTarget(context(battle))).toEqual({ x: 16.5, y: 1.5 });
  battle.projectiles[0].team = "red";
  expect(collectorTarget(context(battle))).toEqual(first);
  battle.projectiles[0].team = "blue";
  battle.projectiles[0].decorative = true;
  expect(collectorTarget(context(battle))).toEqual(first);
});

it.each(["poison", "freeze", "graveyard", "lightning"] as const)(
  "avoids active enemy %s while allowing harmless areas",
  (card) => {
    const battle = setup(),
      first = collectorTarget(context(battle))!;
    battle.areas.push(cloud(card, "blue", first.x, first.y));
    expect(collectorTarget(context(battle))).toEqual({ x: 16.5, y: 1.5 });
    battle.areas[0].team = "red";
    expect(collectorTarget(context(battle))).toEqual(first);
    battle.areas[0].team = "blue";
    battle.areas[0].remaining = 0;
    expect(collectorTarget(context(battle))).toEqual(first);
    battle.areas[0].remaining = 8;
    battle.areas[0].card = "rage";
    expect(collectorTarget(context(battle))).toEqual(first);
  },
);

it("mirrors the policy exactly without changing entities, projectiles, areas or RNG", () => {
  const battle = setup();
  battle.projectiles.push(blast("blue", 1.5, 1.5));
  const before = snapshot(battle),
    random = vi.spyOn(battle, "random");
  const point = collectorTarget(context(battle))!;
  const rotated = perspective(before, "red");
  const mirrored = collectorTarget({
    ...context(battle),
    team: "blue",
    entities: rotated.entities,
    projectiles: rotated.projectiles,
    areas: rotated.areas ?? [],
    legal: (p) =>
      battle.canPlace("red", "elixir-collector", 18 - p.x, 32 - p.y).ok,
  });
  expect(mirrored).toEqual({ x: 18 - point.x, y: 32 - point.y });
  expect(snapshot(battle)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
});

it("uses Mirror's actual cost when considering another economy investment", () => {
  const battle = setup();
  battle.players.red.hand = ["mirror", "rage", "heal", "clone"];
  battle.players.red.lastPlayed = "elixir-collector";
  think(battle);
  expect(battle.actions).toEqual([]);
  battle.players.red.elixir = 9;
  think(battle);
  expect(battle.actions[0]).toMatchObject({ card: "mirror", y: 1.5 });
  expect(battle.players.red.elixir).toBe(2);
  expect(battle.entities.at(-1)!.card).toBe("elixir-collector");
});

it("reconstructs a legal AI Collector investment, production and later card plays exactly", () => {
  const enemyDeck: CardId[] = [
    "golem",
    "night-witch",
    "baby-dragon",
    "guards",
    "ice-wizard",
    "tornado",
    "elixir-collector",
    "lightning",
  ];
  let battle: Battle | undefined;
  for (let seed = 1; seed < 1000; seed++) {
    const candidate = new Battle({ seed, ai: true, enemyDeck });
    if (
      candidate.players.red.hand.every((card) =>
        ["golem", "tornado", "elixir-collector", "lightning"].includes(card),
      )
    ) {
      battle = candidate;
      break;
    }
  }
  expect(battle).toBeDefined();
  const live = battle!;
  for (let i = 0; i < 1200 && !live.winner; i++) live.step();
  expect(
    live.actions.some((action) => action.card === "elixir-collector"),
  ).toBe(true);
  expect(live.audioEvents.some((event) => event.phase === "collect")).toBe(
    true,
  );
  const replay = live.exportReplay(),
    rebuilt = new Battle({ replay });
  while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
  expect(rebuilt.actions).toEqual(live.actions);
  expect(rebuilt.entities).toEqual(live.entities);
  expect(rebuilt.players).toEqual(live.players);
  expect(rebuilt.projectiles).toEqual(live.projectiles);
  expect(rebuilt.audioEvents).toEqual(live.audioEvents);
  expect(rebuilt.areas).toEqual(live.areas);
  expect(rebuilt.winner).toBe(live.winner);
});
