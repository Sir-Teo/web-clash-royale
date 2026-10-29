import { expect, it, vi } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { minerTarget } from "../src/game/miner-targeting";
import { attackReach } from "../src/game/attack-range";
import { perspective, snapshot } from "../src/network/perspective";
import { SOLO_OPPONENTS } from "../src/game/opponents";

function setup() {
  const battle = new Battle({ seed: 12, ai: false });
  battle.players.red.hand = ["miner", "knight", "golem", "three-musketeers"];
  battle.players.red.elixir = 6;
  return battle;
}
const think = (battle: Battle) => (battle as any).think();
const crown = (battle: Battle, lane: "left" | "right" = "left") =>
  battle.entities.find(
    (entity) => entity.team === "blue" && entity.lane === lane,
  )!;
const king = (battle: Battle) =>
  battle.entities.find((entity) => entity.team === "blue" && entity.king)!;
function context(battle: Battle) {
  return {
    team: "red" as const,
    elixir: battle.players.red.elixir,
    cost: battle.cardCost("red", battle.players.red.hand[0])!,
    remaining: 180,
    entities: battle.entities,
    projectiles: battle.projectiles,
    areas: battle.areas,
    legal: (point: { x: number; y: number }) =>
      battle.canPlace("red", "miner", point.x, point.y).ok,
  };
}
function unit(battle: Battle, card: CardId, x: number, y: number) {
  (battle as any).spawn(card, "blue", x, y);
  return battle.entities.at(-1)!;
}
function firstHit(battle: Battle, target: Entity, damage: number) {
  const hp = target.hp;
  for (
    let i = 0;
    i < 300 &&
    !battle.events.some((e) => e.type === "hit" && e.card === "miner");
    i++
  )
    battle.step();
  expect(
    battle.events.find((e) => e.type === "hit" && e.card === "miner"),
  ).toMatchObject({ x: target.x, y: target.y, value: damage });
  const body = battle.entities.find(
    (entity) => entity.team === "red" && entity.card === "miner",
  )!;
  if (target.hp > 0) expect(body.target).toBe(target.id);
  expect(distance(body, target)).toBeLessThanOrEqual(attackReach(body, target));
  expect(hp - target.hp).toBeGreaterThanOrEqual(damage);
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

it("uses a legal enemy-half tunnel and deals the native reduced Crown hit", () => {
  const battle = setup(),
    target = crown(battle, "right");
  target.hp = 1000;
  const plan = minerTarget(context(battle))!;
  expect(plan.target).toBe(target.id);
  expect(plan.point.y).toBeGreaterThan(18);
  think(battle);
  expect(battle.actions[0]).toMatchObject({ card: "miner", ...plan.point });
  expect(battle.players.red.elixir).toBe(3);
  expect(battle.entities.some((entity) => entity.card === "miner")).toBe(false);
  expect(
    battle.projectiles.find((p) => p.style === "miner-travel"),
  ).toMatchObject({ tx: plan.point.x, ty: plan.point.y });
  firstHit(battle, target, 78);
});

it("disrupts an exposed Collector with full building damage", () => {
  const battle = setup(),
    target = unit(battle, "elixir-collector", 1.5, 30.5);
  expect(minerTarget(context(battle))).toMatchObject({
    target: target.id,
    score: 4.5,
  });
  think(battle);
  firstHit(battle, target, CARD_MAP.miner.damage);
});

it("finishes a one-hit Crown before attacking a Collector", () => {
  const battle = setup(),
    target = crown(battle);
  target.hp = 78;
  unit(battle, "elixir-collector", 1.5, 30.5);
  expect(minerTarget(context(battle))).toMatchObject({
    target: target.id,
    score: 8,
  });
  think(battle);
  firstHit(battle, target, 78);
  expect(battle.players.red.crowns).toBe(1);
});

it("avoids waking a healthy King but can finish it immediately", () => {
  const battle = setup(),
    target = king(battle);
  target.hp = 100;
  expect(minerTarget(context(battle))!.target).not.toBe(target.id);
  target.hp = 78;
  expect(minerTarget(context(battle))!.target).toBe(target.id);
  think(battle);
  firstHit(battle, target, 78);
  expect(battle.winner).toBe("red");
});

it("uses an open lane to hit the active King without the surviving Princess firing", () => {
  const battle = setup(),
    target = king(battle);
  crown(battle).hp = 0;
  Object.assign(target, { hp: 1000, active: true });
  const plan = minerTarget(context(battle))!;
  expect(plan.target).toBe(target.id);
  expect(distance(plan.point, crown(battle, "right"))).toBeGreaterThan(
    attackReach(crown(battle, "right"), { radius: 0.5 }),
  );
  think(battle);
  firstHit(battle, target, 78);
});

it("lands outside an active King's coverage when attacking a Princess", () => {
  const battle = setup();
  king(battle).active = true;
  crown(battle).hp = 1000;
  const plan = minerTarget(context(battle))!;
  expect(plan.target).toBe(crown(battle).id);
  expect(distance(plan.point, king(battle))).toBeGreaterThan(
    attackReach(king(battle), { radius: 0.5 }),
  );
});

it.each(["pekka", "minion-horde"] as const)(
  "avoids a %s guarded weak lane",
  (card) => {
    const battle = setup();
    crown(battle).hp = 1000;
    for (const x of [1, 3.5, 6]) {
      const before = battle.entities.length;
      unit(battle, card, x, 25.5);
      for (const body of battle.entities.slice(before))
        Object.assign(body, { deploy: 0 });
    }
    expect(minerTarget(context(battle))!.target).toBe(
      crown(battle, "right").id,
    );
  },
);

it("rejects an occupied site and a ground screen that would win acquisition", () => {
  const battle = setup();
  expect(
    minerTarget({ ...context(battle), legal: () => false }),
  ).toBeUndefined();
  for (const target of battle.entities.filter(
    (e) => e.team === "blue" && e.kind === "tower",
  ))
    for (const offset of [-2, 0, 2])
      unit(battle, "knight", target.x + offset, target.y);
  expect(minerTarget(context(battle))).toBeUndefined();
});

it("ignores a blast before arrival but avoids one still pending at emergence", () => {
  const battle = setup();
  crown(battle).hp = 1000;
  const blast: Projectile = {
    id: 100,
    team: "blue",
    x: 3.5,
    y: 25.5,
    tx: 3.5,
    ty: 25.5,
    target: null,
    damage: 1484,
    remaining: 0.5,
    duration: 4,
    splash: 5,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
  };
  battle.projectiles.push(blast);
  expect(minerTarget(context(battle))!.target).toBe(crown(battle).id);
  blast.remaining = 4;
  expect(minerTarget(context(battle))!.target).toBe(crown(battle, "right").id);
  blast.remaining = 0.5;
  blast.delay = 4;
  expect(minerTarget(context(battle))!.target).toBe(crown(battle, "right").id);
});

it.each(["poison", "freeze", "tornado", "graveyard"] as const)(
  "accounts for %s remaining after tunnel arrival",
  (card) => {
    const battle = setup(),
      target = crown(battle);
    target.hp = 1000;
    const area = {
      id: 100,
      team: "blue" as const,
      card,
      x: target.x,
      y: target.y,
      radius: 5,
      remaining: 8,
      duration: 8,
    };
    battle.areas.push(area);
    expect(minerTarget(context(battle))!.target).toBe(
      crown(battle, "right").id,
    );
    area.remaining = 0.5;
    expect(minerTarget(context(battle))!.target).toBe(target.id);
  },
);

it("does not duplicate a Crown kill covered by released damage", () => {
  const battle = setup(),
    target = crown(battle);
  target.hp = 10;
  battle.areas.push({
    id: 100,
    team: "red",
    card: "poison",
    x: target.x,
    y: target.y,
    radius: 3.5,
    remaining: 8,
    duration: 8,
  });
  expect(minerTarget(context(battle))!.target).toBe(crown(battle, "right").id);
});

it("keeps the defense reserve, Mirror cost and sufficient time to attack", () => {
  const battle = setup();
  expect(
    minerTarget({ ...context(battle), elixir: 5 - 1.1e-6 }),
  ).toBeUndefined();
  expect(minerTarget({ ...context(battle), elixir: 5 - 0.9e-6 })).toBeDefined();
  expect(minerTarget({ ...context(battle), remaining: 3 })).toBeUndefined();
  battle.players.red.hand[0] = "mirror";
  battle.players.red.lastPlayed = "miner";
  expect(minerTarget({ ...context(battle), elixir: 5 })).toBeUndefined();
  think(battle);
  expect(battle.actions[0].card).toBe("mirror");
  expect(battle.actions[0].y).toBeGreaterThan(18);
  expect(battle.players.red.elixir).toBe(2);
});

it("returns to defense when a push approaches the river", () => {
  const battle = setup();
  unit(battle, "knight", 4, 18);
  expect(minerTarget(context(battle))).toBeUndefined();
  think(battle);
  expect(battle.actions[0].y).toBeLessThan(15);
});

it("preserves pressure savings for chip but allows a Collector counter", () => {
  const battle = setup();
  battle.players.red.hand[1] = "x-bow";
  think(battle);
  expect(battle.actions).toEqual([]);
  unit(battle, "elixir-collector", 1.5, 30.5);
  think(battle);
  expect(battle.actions[0].card).toBe("miner");
});

it("preserves a faster known spell finisher", () => {
  const battle = setup();
  battle.players.red.hand[1] = "rocket";
  king(battle).hp = 50;
  think(battle);
  expect(battle.actions[0].card).toBe("rocket");
});

it("rotates its native target geometry exactly without changing state or RNG", () => {
  const battle = setup();
  crown(battle, "right").hp = 1000;
  const before = snapshot(battle),
    random = vi.spyOn(battle, "random");
  const plan = minerTarget(context(battle))!,
    rotated = perspective(before, "red");
  expect(
    minerTarget({
      ...context(battle),
      team: "blue",
      entities: rotated.entities,
      projectiles: rotated.projectiles,
      areas: rotated.areas ?? [],
      legal: (p) => battle.canPlace("red", "miner", 18 - p.x, 32 - p.y).ok,
    }),
  ).toEqual({ ...plan, point: { x: 18 - plan.point.x, y: 32 - plan.point.y } });
  expect(snapshot(battle)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
});

it.each(["Mortar Marshal", "Barrel Trickster"])(
  "%s uses offensive Miner and replays exactly",
  (name) => {
    const opponent = SOLO_OPPONENTS.find((o) => o.name === name)!;
    const battle = new Battle({ seed: 12, ai: true, enemyDeck: opponent.deck });
    let hit = false;
    for (let i = 0; i < 1800 && !battle.winner; i++) {
      battle.step();
      if (battle.events.some((e) => e.type === "hit" && e.card === "miner"))
        hit = true;
    }
    expect(battle.actions.some((a) => a.card === "miner" && a.y > 18)).toBe(
      true,
    );
    expect(hit).toBe(true);
    const replay = battle.exportReplay(),
      rebuilt = new Battle({ replay });
    while (rebuilt.tick < replay.duration && !rebuilt.winner) rebuilt.step();
    expect(rebuilt.entities).toEqual(battle.entities);
    expect(rebuilt.players).toEqual(battle.players);
    expect(rebuilt.projectiles).toEqual(battle.projectiles);
    expect(rebuilt.areas).toEqual(battle.areas);
    expect(rebuilt.audioEvents).toEqual(battle.audioEvents);
    expect(rebuilt.actions).toEqual(battle.actions);
    expect(rebuilt.winner).toBe(battle.winner);
  },
);
