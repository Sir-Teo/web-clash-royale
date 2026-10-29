import { expect, it, vi } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { graveyardPlan } from "../src/game/graveyard-targeting";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { perspective, snapshot } from "../src/network/perspective";

function setup(elixir = 7, seed = 12) {
  const b = new Battle({ seed, ai: false });
  b.players.red.hand = ["graveyard", "knight", "golem", "three-musketeers"];
  b.players.red.elixir = elixir;
  return b;
}
const think = (b: Battle) => (b as any).think();
const crown = (b: Battle, lane = "left") =>
  b.entities.find((e) => e.team === "blue" && e.lane === lane)!;
const king = (b: Battle) =>
  b.entities.find((e) => e.team === "blue" && e.king)!;
function context(b: Battle) {
  return {
    team: "red" as const,
    remaining: 180,
    entities: b.entities,
    projectiles: b.projectiles,
    areas: b.areas,
    cards: b.players.red.hand.map((id) => ({
      id,
      played: b.cardForPlay("red", id) ?? id,
      cost: b.cardCost("red", id),
    })),
    legal: (card: CardId, p: { x: number; y: number }) =>
      b.canPlace("red", card, p.x, p.y).ok,
  };
}
function unit(b: Battle, card: CardId, x: number, y: number) {
  (b as any).spawn(card, "blue", x, y);
  return b.entities.at(-1)!;
}
function hit(b: Battle, target: Entity) {
  const hp = target.hp;
  for (
    let i = 0;
    i < 600 &&
    !b.events.some((e) => e.type === "hit" && e.card === "skeletons");
    i++
  )
    b.step();
  expect(
    b.events.find((e) => e.type === "hit" && e.card === "skeletons"),
  ).toMatchObject({
    x: target.x,
    y: target.y,
    value: CARD_MAP.skeletons.damage,
  });
  expect(hp - target.hp).toBeGreaterThanOrEqual(CARD_MAP.skeletons.damage);
}

it("saves for Graveyard, casts at the edge and produces Skeletons that actually hit a Crown", () => {
  const b = setup(6),
    target = crown(b);
  expect(graveyardPlan(context(b))).toMatchObject({
    id: "graveyard",
    point: { x: 0.7, y: 24.5 },
    target: target.id,
    requiredElixir: 7,
  });
  think(b);
  expect(b.actions).toEqual([]);
  b.players.red.elixir = 7;
  think(b);
  expect(b.actions[0]).toMatchObject({ card: "graveyard", x: 0.7, y: 24.5 });
  expect(b.players.red.elixir).toBe(2);
  expect(b.areas[0]).toMatchObject({ card: "graveyard", remaining: 10 });
  hit(b, target);
  expect(king(b).active).toBe(false);
});

it.each([1, 12, 42])(
  "seed %s keeps the dormant King asleep until the real Princess falls",
  (seed) => {
    const b = setup(7, seed),
      target = crown(b);
    think(b);
    for (let i = 0; i < 600 && target.hp > 0; i++) {
      b.step();
      if (b.players.red.crowns === 0) expect(king(b).active).toBe(false);
    }
    expect(target.hp).toBe(0);
    expect(b.players.red.crowns).toBe(1);
  },
);

it("targets and actually damages the weaker Princess while the King is active", () => {
  const b = setup(),
    target = crown(b, "right");
  target.hp = 1000;
  king(b).active = true;
  expect(graveyardPlan(context(b))).toMatchObject({
    target: target.id,
    point: { x: 17.3, y: 24.5 },
  });
  think(b);
  hit(b, target);
});

it("reserves actual Mirror cost and permits the remaining King as its real spell target", () => {
  const b = setup(7),
    target = king(b);
  b.players.red.hand[0] = "mirror";
  b.players.red.lastPlayed = "graveyard";
  expect(graveyardPlan(context(b))).toMatchObject({
    id: "mirror",
    requiredElixir: 8,
  });
  think(b);
  expect(b.actions).toEqual([]);
  b.players.red.elixir = 8;
  crown(b).hp = 0;
  crown(b, "right").hp = 0;
  Object.assign(target, { active: true, hp: 1000 });
  think(b);
  expect(b.actions[0]).toMatchObject({ card: "mirror", x: 9, y: 29 });
  expect(b.players.red.elixir).toBe(2);
  hit(b, target);
});

it("honors the shared elixir tolerance at the funding boundary", () => {
  const b = setup(7 - 1.1e-6);
  think(b);
  expect(b.actions).toEqual([]);
  b.players.red.elixir = 7 - 0.9e-6;
  think(b);
  expect(b.actions[0].card).toBe("graveyard");
});

it.each(["wizard", "minion-horde", "pekka"] as const)(
  "avoids a weak lane guarded by %s",
  (card) => {
    const b = setup(),
      target = crown(b);
    target.hp = 1000;
    unit(b, card, target.x, target.y);
    expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
  },
);

it("rejects a Collector that can win acquisition in part of the possible spawn disk", () => {
  const b = setup();
  crown(b).hp = 1000;
  unit(b, "elixir-collector", 1.5, 30.5);
  expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
});

it("rejects an unsafe King boundary, unavailable sites and insufficient remaining time", () => {
  const b = setup();
  expect(graveyardPlan({ ...context(b), legal: () => false })).toBeUndefined();
  expect(graveyardPlan({ ...context(b), remaining: 14.99 })).toBeUndefined();
  expect(graveyardPlan({ ...context(b), remaining: 15 })).toBeDefined();
  Object.assign(king(b), { x: 9, y: 25.5 });
  expect(graveyardPlan(context(b))).toBeUndefined();
});

it("holds a duplicate while a friendly Graveyard is still producing waves", () => {
  const b = setup();
  think(b);
  b.players.red.hand[0] = "graveyard";
  expect(graveyardPlan(context(b))).toBeUndefined();
  b.areas[0].remaining = 0;
  expect(graveyardPlan(context(b))).toBeDefined();
});

it("ignores early blasts and avoids hostile splash still pending at first spawn", () => {
  const b = setup(),
    target = crown(b);
  target.hp = 1000;
  const shot: Projectile = {
    id: 100,
    team: "blue",
    x: target.x,
    y: target.y,
    tx: target.x,
    ty: target.y,
    target: null,
    damage: 1484,
    remaining: 1,
    duration: 4,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
  };
  b.projectiles.push(shot);
  expect(graveyardPlan(context(b))!.target).toBe(target.id);
  shot.remaining = 2;
  expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
  shot.remaining = 1;
  shot.delay = 2;
  expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
});

it.each(["poison", "freeze", "tornado", "graveyard"] as const)(
  "checks %s against the full spawn disk and its first spawn clock",
  (card) => {
    const b = setup(),
      target = crown(b);
    target.hp = 1000;
    const area = {
      id: 100,
      team: "blue" as const,
      card,
      x: target.x,
      y: target.y,
      radius: 3.5,
      remaining: 8,
      duration: 8,
    };
    b.areas.push(area);
    expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
    area.remaining = 1;
    expect(graveyardPlan(context(b))!.target).toBe(target.id);
  },
);

it("does not buy a Crown kill already covered by released damage", () => {
  const b = setup(),
    target = crown(b);
  target.hp = 10;
  b.areas.push({
    id: 100,
    team: "red",
    card: "poison",
    x: target.x,
    y: target.y,
    radius: 3.5,
    remaining: 8,
    duration: 8,
  });
  expect(graveyardPlan(context(b))!.target).toBe(crown(b, "right").id);
});

it("cancels saving when an air push approaches the river", () => {
  const b = setup(6);
  b.players.red.hand[3] = "musketeer";
  unit(b, "baby-dragon", 4, 18);
  expect(graveyardPlan(context(b))).toBeUndefined();
  think(b);
  expect(b.actions[0].card).toBe("musketeer");
});

it("permits a known Rocket finisher while saving for Graveyard", () => {
  const b = setup(6);
  b.players.red.hand[1] = "rocket";
  king(b).hp = 50;
  think(b);
  expect(b.actions[0].card).toBe("rocket");
});

it("funds the cheaper hut before another pressure spell", () => {
  const b = setup(6);
  b.players.red.hand[1] = "furnace";
  think(b);
  expect(b.actions[0].card).toBe("furnace");
  expect(b.players.red.elixir).toBe(2);
});

it("allows an exposed Collector counter before the Graveyard reserve is funded", () => {
  const b = setup(6);
  b.players.red.hand[1] = "miner";
  unit(b, "elixir-collector", 1.5, 30.5);
  think(b);
  expect(b.actions[0].card).toBe("miner");
});

it("rotates its spawn envelope without changing state or either RNG stream", () => {
  const b = setup();
  crown(b, "right").hp = 1000;
  b.areas.push({
    id: 100,
    team: "blue",
    card: "graveyard",
    x: 3.5,
    y: 25.5,
    radius: 5,
    remaining: 10,
    duration: 10,
    spawnRandomState: 1234567,
  });
  const before = snapshot(b),
    random = vi.spyOn(b, "random");
  const plan = graveyardPlan(context(b))!,
    rotated = perspective(before, "red");
  expect(
    graveyardPlan({
      ...context(b),
      team: "blue",
      entities: rotated.entities,
      projectiles: rotated.projectiles,
      areas: rotated.areas ?? [],
      legal: (card, p) => b.canPlace("red", card, 18 - p.x, 32 - p.y).ok,
    }),
  ).toEqual({ ...plan, point: { x: 18 - plan.point.x, y: 32 - plan.point.y } });
  expect(snapshot(b)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
});

it.each([1, 12, 42])(
  "Grave Keeper uses Graveyard and reconstructs its seed-%s opening exactly",
  (seed) => {
    const opponent = SOLO_OPPONENTS.find((o) => o.name === "Grave Keeper")!;
    const b = new Battle({ seed, ai: true, enemyDeck: opponent.deck });
    let hit = false;
    for (let i = 0; i < 1800 && !b.winner; i++) {
      b.step();
      if (
        b.events.some(
          (e) =>
            e.type === "hit" &&
            e.card === "skeletons" &&
            e.team === "red" &&
            e.y > 20,
        )
      )
        hit = true;
    }
    expect(b.actions.some((a) => a.card === "graveyard" && a.y > 20)).toBe(
      true,
    );
    expect(hit).toBe(true);
    const replay = b.exportReplay(),
      rebuilt = new Battle({ replay });
    while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
    expect(rebuilt.entities).toEqual(b.entities);
    expect(rebuilt.players).toEqual(b.players);
    expect(rebuilt.projectiles).toEqual(b.projectiles);
    expect(rebuilt.areas).toEqual(b.areas);
    expect(rebuilt.audioEvents).toEqual(b.audioEvents);
    expect(rebuilt.actions).toEqual(b.actions);
    expect(rebuilt.winner).toBe(b.winner);
  },
);
