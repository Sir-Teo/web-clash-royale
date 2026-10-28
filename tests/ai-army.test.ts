import { expect, it, vi } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { armyPlan } from "../src/game/army-targeting";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { perspective, snapshot } from "../src/network/perspective";

function setup(card: CardId = "golem", elixir = 6) {
  const b = new Battle({ seed: 12, ai: false });
  b.players.red.hand = [card, "knight", "skeletons", "archers"];
  b.players.red.elixir = elixir;
  return b;
}
const think = (b: Battle) => (b as any).think();
const crown = (b: Battle, lane = "left") =>
  b.entities.find((e) => e.team === "blue" && e.lane === lane)!;
const king = (b: Battle) =>
  b.entities.find((e) => e.team === "blue" && e.king)!;
const child = (card: CardId): CardId =>
  card === "three-musketeers" ? "musketeer" : card;
function context(b: Battle) {
  return {
    team: "red" as const,
    rulesVersion: b.rulesVersion,
    remaining: b.remaining,
    elixir: b.players.red.elixir,
    elixirRate: b.multiplier / 2.8,
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
function unit(
  b: Battle,
  card: CardId,
  team: "blue" | "red",
  x: number,
  y: number,
) {
  (b as any).spawn(card, team, x, y);
  return b.entities.at(-1)!;
}
function hit(b: Battle, card: CardId, target: Entity) {
  const hp = target.hp,
    body = child(card);
  for (
    let i = 0;
    i < 1500 && !b.events.some((e) => e.type === "hit" && e.card === body);
    i++
  )
    b.step();
  expect(
    b.events.find((e) => e.type === "hit" && e.card === body),
  ).toMatchObject({ x: target.x, y: target.y, value: CARD_MAP[body].damage });
  expect(hp - target.hp).toBeGreaterThanOrEqual(CARD_MAP[body].damage);
}

it.each(["golem", "lava-hound", "three-musketeers"] as const)(
  "saves for %s despite cheaper support and its real army hits the weaker Crown",
  (card) => {
    const b = setup(card),
      target = crown(b, "right");
    target.hp = 1000;
    const required = Math.min(10, CARD_MAP[card].cost + 2);
    expect(armyPlan(context(b))).toMatchObject({
      id: card,
      target: target.id,
      requiredElixir: required,
      point: { x: target.x, y: 9 },
    });
    think(b);
    expect(b.actions).toEqual([]);
    b.players.red.elixir = required;
    think(b);
    expect(b.actions[0]).toMatchObject({ card, x: target.x, y: 9 });
    expect(b.players.red.elixir).toBe(required - CARD_MAP[card].cost);
    expect(
      b.entities.filter((e) => e.team === "red" && e.card === child(card)),
    ).toHaveLength(CARD_MAP[card].count);
    hit(b, card, target);
  },
);

it.each(["golem", "lava-hound", "three-musketeers"] as const)(
  "funds a mirrored %s within the ten-elixir cap",
  (card) => {
    const b = setup("mirror", 9);
    b.players.red.lastPlayed = card;
    expect(armyPlan(context(b))).toMatchObject({
      id: "mirror",
      requiredElixir: 10,
    });
    think(b);
    expect(b.actions).toEqual([]);
    b.players.red.elixir = 10;
    think(b);
    expect(b.actions[0].card).toBe("mirror");
    expect(b.players.red.elixir).toBe(10 - CARD_MAP[card].cost - 1);
    expect(
      b.entities.filter((e) => e.team === "red" && e.card === child(card)),
    ).toHaveLength(CARD_MAP[card].count);
  },
);

it("honors the reserve tolerance without requiring impossible eleven-elixir savings", () => {
  const b = setup("lava-hound", 9 - 1.1e-6);
  think(b);
  expect(b.actions).toEqual([]);
  b.players.red.elixir = 9 - 0.9e-6;
  think(b);
  expect(b.actions[0].card).toBe("lava-hound");
  expect(b.players.red.elixir).toBeCloseTo(2, 5);
});

it("does not buy another live tank, while an expiring clone does not suppress a real push", () => {
  const b = setup(),
    existing = unit(b, "golem", "red", 4, 9);
  expect(armyPlan(context(b))).toBeUndefined();
  existing.clone = true;
  expect(armyPlan(context(b))).toBeDefined();
  existing.clone = false;
  existing.hp = 0;
  expect(armyPlan(context(b))).toBeDefined();
});

it("recognizes Three Musketeers by their actual Musketeer child bodies", () => {
  const b = setup("three-musketeers");
  for (let i = 0; i < 3; i++) unit(b, "musketeer", "red", 4 + i, 9);
  expect(armyPlan(context(b))).toBeUndefined();
  b.entities.at(-1)!.hp = 0;
  expect(armyPlan(context(b))).toBeDefined();
});

it("does not reserve offensive armies for unrelated expensive defenders or ordinary troops", () => {
  const b = setup("pekka");
  b.players.red.hand = ["pekka", "giant-skeleton", "royal-giant", "knight"];
  expect(armyPlan(context(b))).toBeUndefined();
});

it("sends a real Golem toward the remaining King", () => {
  const b = setup("golem", 10),
    target = king(b);
  crown(b).hp = 0;
  crown(b, "right").hp = 0;
  target.active = true;
  expect(armyPlan(context(b))!.target).toBe(target.id);
  think(b);
  hit(b, "golem", target);
});

it("cancels saving when an air push reaches the opposite river bank", () => {
  const b = setup();
  b.players.red.hand[3] = "musketeer";
  const push = unit(b, "baby-dragon", "blue", 4, 18);
  expect(armyPlan(context(b))).toBeUndefined();
  push.y = 10;
  think(b);
  expect(b.actions[0].card).toBe("musketeer");
});

it("allows a faster known Rocket finisher instead of continuing to bank", () => {
  const b = setup();
  b.players.red.hand[1] = "rocket";
  king(b).hp = 50;
  think(b);
  expect(b.actions[0].card).toBe("rocket");
});

it("permits a ready Collector before saving for a Golem", () => {
  const b = setup("golem", 8);
  b.players.red.hand[1] = "elixir-collector";
  think(b);
  expect(b.actions[0].card).toBe("elixir-collector");
});

it("funds the cheaper hut or Graveyard pressure before a costly army", () => {
  const hut = setup();
  hut.players.red.hand[1] = "furnace";
  think(hut);
  expect(hut.actions[0].card).toBe("furnace");
  const spell = setup("golem", 7);
  spell.players.red.hand[1] = "graveyard";
  think(spell);
  expect(spell.actions[0].card).toBe("graveyard");
});

it("permits an exposed-Collector Miner counter while the army is not yet funded", () => {
  const b = setup();
  b.players.red.hand[1] = "miner";
  unit(b, "elixir-collector", "blue", 1.5, 30.5);
  think(b);
  expect(b.actions[0].card).toBe("miner");
});

it("finds another legal deployment when the intended point is occupied", () => {
  const b = setup();
  unit(b, "cannon", "red", 3.5, 9);
  const plan = armyPlan(context(b))!;
  expect(plan.point).not.toEqual({ x: 3.5, y: 9 });
  expect(b.canPlace("red", "golem", plan.point.x, plan.point.y).ok).toBe(true);
  expect(armyPlan({ ...context(b), legal: () => false })).toBeUndefined();
});

it("uses actual readiness to reject a late push and allows a shorter forward site", () => {
  const b = setup("three-musketeers", 10);
  expect(armyPlan({ ...context(b), remaining: 1 })).toBeUndefined();
  const plan = armyPlan({ ...context(b), remaining: 13 });
  expect(plan?.point.y).toBe(11.5);
});

it("includes elixir regeneration before committing to a late tank", () => {
  const b = setup("golem", 6);
  b.tick = 153 * 30;
  expect(armyPlan(context(b))).toBeUndefined();
  b.players.red.elixir = 10;
  expect(armyPlan(context(b))).toBeDefined();
});

it.each(["miner", "goblin-barrel"] as const)(
  "permits a viable %s before an unfunded army, then resumes saving",
  (card) => {
    const b = setup();
    b.players.red.hand[1] = card;
    think(b);
    expect(b.actions[0].card).toBe(card);
    b.players.red.elixir = 6;
    think(b);
    expect(b.actions).toHaveLength(1);
  },
);

it("avoids a known Rocket footprint across the entire deployment formation", () => {
  const b = setup("three-musketeers");
  const rocket: Projectile = {
    id: 100,
    team: "blue",
    x: 9,
    y: 29,
    tx: 3.5,
    ty: 9,
    target: null,
    damage: 1484,
    remaining: 2,
    duration: 4,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
  };
  b.projectiles.push(rocket);
  expect(armyPlan(context(b))!.point).not.toEqual({ x: 3.5, y: 9 });
});

it("distinguishes ground-only incoming damage from a Lava Hound hazard", () => {
  const b = setup("lava-hound");
  b.projectiles.push({
    id: 100,
    team: "blue",
    x: 3.5,
    y: 9,
    tx: 3.5,
    ty: 9,
    target: null,
    damage: 1000,
    remaining: 2,
    duration: 4,
    splash: 100,
    air: false,
    style: "bomb",
    stun: 0,
    source: 0,
  });
  expect(armyPlan(context(b))).toBeDefined();
  b.players.red.hand[0] = "golem";
  expect(armyPlan(context(b))).toBeUndefined();
});

it.each(["poison", "freeze", "lightning", "tornado"] as const)(
  "rejects deployment sites covered by active enemy %s",
  (card) => {
    const b = setup();
    b.areas.push({
      id: 100,
      team: "blue",
      card,
      x: 9,
      y: 9,
      radius: 100,
      remaining: 3,
      duration: 3,
    });
    expect(armyPlan(context(b))).toBeUndefined();
    b.areas[0].remaining = 0;
    expect(armyPlan(context(b))).toBeDefined();
  },
);

it("rotates the chosen lane exactly without changing state or RNG", () => {
  const b = setup("three-musketeers");
  crown(b, "right").hp = 1000;
  const before = snapshot(b),
    random = vi.spyOn(b, "random");
  const plan = armyPlan(context(b))!,
    rotated = perspective(before, "red");
  expect(
    armyPlan({
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

it.each(["Musketeer Marshal", "Lava Captain", "Golem Warden"])(
  "%s deploys its main army, crosses the river and replays exactly",
  (name) => {
    const opponent = SOLO_OPPONENTS.find((o) => o.name === name)!;
    const card =
      name === "Musketeer Marshal"
        ? "three-musketeers"
        : name === "Lava Captain"
          ? "lava-hound"
          : "golem";
    for (const seed of [1, 12, 42]) {
      const b = new Battle({ seed, ai: true, enemyDeck: opponent.deck });
      let pushed = false;
      for (let i = 0; i < 3600 && !b.winner; i++) {
        b.step();
        if (
          b.entities.some(
            (e) =>
              e.team === "red" &&
              e.card === child(card) &&
              e.hp > 0 &&
              e.y >= 17.5,
          )
        )
          pushed = true;
      }
      expect(b.actions.some((a) => a.card === card)).toBe(true);
      expect(pushed).toBe(true);
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
    }
  },
);
