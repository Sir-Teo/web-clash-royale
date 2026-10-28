import { expect, it, vi } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { barrelTarget } from "../src/game/barrel-targeting";
import { barrelFormation } from "../src/game/barrel-formation";
import { attackReach } from "../src/game/attack-range";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { snapshot, perspective } from "../src/network/perspective";

function setup() {
  const battle = new Battle({ seed: 12, ai: false });
  battle.players.red.hand = [
    "goblin-barrel",
    "knight",
    "golem",
    "three-musketeers",
  ];
  battle.players.red.elixir = 6;
  return battle;
}
const crown = (b: Battle, lane = "left") =>
  b.entities.find((e) => e.team === "blue" && e.lane === lane)!;
const king = (b: Battle) =>
  b.entities.find((e) => e.team === "blue" && e.king)!;
const think = (b: Battle) => (b as any).think();
function unit(b: Battle, card: CardId, x: number, y: number) {
  (b as any).spawn(card, "blue", x, y);
  return b.entities.at(-1)!;
}
function context(b: Battle) {
  return {
    team: "red" as const,
    elixir: b.players.red.elixir,
    cost: b.cardCost("red", b.players.red.hand[0])!,
    remaining: 180,
    entities: b.entities,
    projectiles: b.projectiles,
    areas: b.areas,
    legal: (p: { x: number; y: number }) =>
      b.canPlace("red", "goblin-barrel", p.x, p.y).ok,
  };
}
function hit(b: Battle, target: Entity) {
  const hp = target.hp;
  for (
    let i = 0;
    i < 300 && !b.events.some((e) => e.type === "hit" && e.card === "goblins");
    i++
  )
    b.step();
  const hits = b.events.filter((e) => e.type === "hit" && e.card === "goblins");
  expect(hits.length).toBeGreaterThan(0);
  for (const event of hits)
    expect(event).toMatchObject({
      x: target.x,
      y: target.y,
      value: CARD_MAP.goblins.damage,
    });
  expect(hp - target.hp).toBeGreaterThanOrEqual(CARD_MAP.goblins.damage);
  if (target.hp > 0)
    for (const body of b.entities.filter(
      (e) => e.team === "red" && e.card === "goblins",
    )) {
      expect(body.target).toBe(target.id);
      expect(
        Math.hypot(body.x - target.x, body.y - target.y),
      ).toBeLessThanOrEqual(attackReach(body, target));
    }
}

it("launches at the weaker Princess and its actual children deal full Crown damage", () => {
  const b = setup(),
    target = crown(b, "right");
  target.hp = 1000;
  expect(barrelTarget(context(b))).toMatchObject({
    point: { x: target.x, y: target.y },
    target: target.id,
  });
  think(b);
  expect(b.actions[0]).toMatchObject({
    card: "goblin-barrel",
    x: target.x,
    y: target.y,
  });
  expect(b.players.red.elixir).toBe(3);
  expect(b.entities.some((e) => e.team === "red" && e.card === "goblins")).toBe(
    false,
  );
  const shot = b.projectiles.find((p) => p.style === "goblin-barrel")!;
  expect(shot.duration).toBeCloseTo(
    Math.hypot(target.x - 9, target.y - 2) / (400 / 60),
  );
  hit(b, target);
  expect(
    b.entities.filter((e) => e.team === "red" && e.card === "goblins"),
  ).toHaveLength(3);
  expect(king(b).active).toBe(false);
});

it("counters a rear Collector using edge-clamped Goblins that really hit it", () => {
  const b = setup(),
    target = unit(b, "elixir-collector", 1.5, 31);
  expect(barrelTarget(context(b))).toMatchObject({
    target: target.id,
    score: 4.5,
  });
  think(b);
  while (b.projectiles.some((p) => p.style === "goblin-barrel")) b.step();
  expect(
    b.entities
      .filter((e) => e.team === "red" && e.card === "goblins")
      .some((e) => e.y === 31.2),
  ).toBe(true);
  hit(b, target);
});

it("finishes a one-hit Crown before countering a Collector", () => {
  const b = setup(),
    target = crown(b);
  target.hp = CARD_MAP.goblins.damage;
  unit(b, "elixir-collector", 1.5, 30.5);
  expect(barrelTarget(context(b))).toMatchObject({
    target: target.id,
    score: 7,
  });
  think(b);
  hit(b, target);
  expect(b.players.red.crowns).toBe(1);
});

it("avoids waking a healthy King and can finish one through an open lane", () => {
  const b = setup(),
    target = king(b);
  target.hp = 1000;
  expect(barrelTarget(context(b))!.target).not.toBe(target.id);
  crown(b).hp = 0;
  target.hp = CARD_MAP.goblins.damage;
  expect(barrelTarget(context(b))!.target).toBe(target.id);
  think(b);
  hit(b, target);
  expect(b.winner).toBe("red");
});

it("attacks the active King after both Princesses fall", () => {
  const b = setup(),
    target = king(b);
  crown(b).hp = 0;
  crown(b, "right").hp = 0;
  Object.assign(target, { active: true, hp: 1000 });
  expect(barrelTarget(context(b))!.target).toBe(target.id);
  think(b);
  hit(b, target);
});

it.each(["pekka", "wizard", "minion-horde"] as const)(
  "avoids a weak lane guarded by %s",
  (card) => {
    const b = setup(),
      target = crown(b);
    target.hp = 1000;
    unit(b, card, target.x, target.y).deploy = 0;
    expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
  },
);

it("requires every edge-clamped child to acquire its intended target through ground screens", () => {
  const b = setup();
  crown(b).hp = 1000;
  for (const p of barrelFormation(crown(b), "red")) unit(b, "knight", p.x, p.y);
  expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
  expect(barrelTarget({ ...context(b), legal: () => false })).toBeUndefined();
});

it("does not stack a second in-flight barrel on the same target", () => {
  const b = setup();
  crown(b).hp = 1000;
  think(b);
  b.players.red.elixir = 6;
  expect(barrelTarget({ ...context(b), cost: 3 })!.target).toBe(
    crown(b, "right").id,
  );
  b.projectiles.length = 0;
  expect(barrelTarget({ ...context(b), cost: 3 })!.target).toBe(crown(b).id);
});

it("ignores a blast before landing but rejects delayed and later splash", () => {
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
    remaining: 0.5,
    duration: 6,
    splash: 5,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
  };
  b.projectiles.push(shot);
  expect(barrelTarget(context(b))!.target).toBe(target.id);
  shot.remaining = 6;
  expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
  shot.remaining = 0.5;
  shot.delay = 6;
  expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
});

it.each(["poison", "freeze", "tornado", "graveyard"] as const)(
  "checks %s at landing, including each child's footprint",
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
      radius: 4,
      remaining: 8,
      duration: 8,
    };
    b.areas.push(area);
    expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
    area.remaining = 0.5;
    expect(barrelTarget(context(b))!.target).toBe(target.id);
  },
);

it("avoids Poison touching one landing child when the cast center is outside the hazard", () => {
  const b = setup(),
    target = crown(b);
  target.hp = 1000;
  b.areas.push({
    id: 100,
    team: "blue",
    card: "poison",
    x: target.x,
    y: target.y + 4.1,
    radius: 3.5,
    remaining: 8,
    duration: 8,
  });
  expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
});

it("avoids a Crown already covered by released Poison damage", () => {
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
  expect(barrelTarget(context(b))!.target).toBe(crown(b, "right").id);
});

it("keeps the reserve tolerance, actual Mirror cost and enough match time", () => {
  const b = setup();
  expect(barrelTarget({ ...context(b), elixir: 5 - 1.1e-6 })).toBeUndefined();
  expect(barrelTarget({ ...context(b), elixir: 5 - 0.9e-6 })).toBeDefined();
  expect(barrelTarget({ ...context(b), remaining: 4 })).toBeUndefined();
  b.players.red.hand[0] = "mirror";
  b.players.red.lastPlayed = "goblin-barrel";
  expect(barrelTarget({ ...context(b), elixir: 5 })).toBeUndefined();
  think(b);
  expect(b.actions[0].card).toBe("mirror");
  expect(b.players.red.elixir).toBe(2);
  hit(b, crown(b));
});

it("returns to a real air defense when a push approaches", () => {
  const b = setup();
  b.players.red.hand[3] = "musketeer";
  unit(b, "baby-dragon", 4, 10);
  expect(barrelTarget(context(b))).toBeUndefined();
  think(b);
  expect(b.actions[0].card).toBe("musketeer");
});

it("preserves pressure savings for chip but permits an exposed Collector counter", () => {
  const b = setup();
  b.players.red.hand[1] = "x-bow";
  think(b);
  expect(b.actions).toEqual([]);
  unit(b, "elixir-collector", 1.5, 30.5);
  think(b);
  expect(b.actions[0].card).toBe("goblin-barrel");
});

it("preserves faster known spell finishers", () => {
  const b = setup();
  b.players.red.hand[1] = "rocket";
  king(b).hp = 50;
  think(b);
  expect(b.actions[0].card).toBe("rocket");
});

it("rotates the selected target and leaves source state and RNG untouched", () => {
  const b = setup();
  crown(b, "right").hp = 1000;
  const before = snapshot(b),
    random = vi.spyOn(b, "random");
  const plan = barrelTarget(context(b))!,
    rotated = perspective(before, "red");
  expect(
    barrelTarget({
      ...context(b),
      team: "blue",
      entities: rotated.entities,
      projectiles: rotated.projectiles,
      areas: rotated.areas ?? [],
      legal: (p) => b.canPlace("red", "goblin-barrel", 18 - p.x, 32 - p.y).ok,
    }),
  ).toEqual({ ...plan, point: { x: 18 - plan.point.x, y: 32 - plan.point.y } });
  expect(snapshot(b)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
});

it.each([1, 12, 42])(
  "Barrel Trickster casts offensive barrels and replays its seed-%s opening exactly",
  (seed) => {
    const opponent = SOLO_OPPONENTS.find((o) => o.name === "Barrel Trickster")!;
    const b = new Battle({ seed, ai: true, enemyDeck: opponent.deck });
    let hit = false;
    for (let i = 0; i < 1800 && !b.winner; i++) {
      b.step();
      if (
        b.events.some(
          (e) =>
            e.type === "hit" &&
            e.card === "goblins" &&
            e.team === "red" &&
            e.y > 20,
        )
      )
        hit = true;
    }
    expect(b.actions.some((a) => a.card === "goblin-barrel" && a.y > 20)).toBe(
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
