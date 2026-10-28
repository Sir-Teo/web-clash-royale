import { expect, it, vi } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { attackReach, minimumAttackDistance } from "../src/game/attack-range";
import { siegePlan } from "../src/game/siege-targeting";
import { perspective, snapshot } from "../src/network/perspective";

const deck: CardId[] = [
  "x-bow",
  "mortar",
  "knight",
  "musketeer",
  "mirror",
  "rocket",
  "golem",
  "archers",
];
function setup(card: CardId = "x-bow", elixir = 8) {
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
const crown = (battle: Battle, lane: "left" | "right") =>
  battle.entities.find(
    (entity) => entity.team === "blue" && entity.lane === lane,
  )!;
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
function firstHit(battle: Battle, card: CardId, target: Entity) {
  const hp = target.hp;
  for (
    let i = 0;
    i < 450 &&
    !battle.events.some((event) => event.type === "hit" && event.card === card);
    i++
  )
    battle.step();
  const hit = battle.events.find(
    (event) => event.type === "hit" && event.card === card,
  )!;
  expect(hit).toMatchObject({
    x: target.x,
    y: target.y,
    value: CARD_MAP[card].damage,
  });
  const attacker = battle.entities.find(
    (entity) => entity.card === card && entity.team === "red",
  )!;
  expect(attacker.target).toBe(target.id);
  expect(hp - target.hp).toBe(CARD_MAP[card].damage);
  expect(
    Math.hypot(attacker.x - target.x, attacker.y - target.y),
  ).toBeLessThanOrEqual(attackReach(attacker, target));
  return attacker;
}

it("banks for offensive X-Bow rather than cycling its cheaper troops", () => {
  const battle = setup("x-bow", 6);
  expect(siegePlan(context(battle))).toMatchObject({
    id: "x-bow",
    requiredElixir: 8,
    point: { x: 3.5, y: 14 },
  });
  think(battle);
  expect(battle.actions).toEqual([]);
  expect(battle.players.red.elixir).toBe(6);
  battle.players.red.elixir = 8;
  think(battle);
  expect(battle.actions[0]).toMatchObject({ card: "x-bow", x: 3.5, y: 14 });
  expect(battle.players.red.elixir).toBe(2);
  firstHit(battle, "x-bow", crown(battle, "left"));
});

it.each(["x-bow", "mortar"] as const)(
  "%s targets and actually damages the weaker Princess",
  (card) => {
    const battle = setup(card, CARD_MAP[card].cost + 2),
      target = crown(battle, "right");
    target.hp = 1000;
    expect(siegePlan(context(battle))).toMatchObject({
      target: target.id,
      point: { x: 14.5, y: 14 },
    });
    think(battle);
    expect(battle.actions[0]).toMatchObject({ card, x: 14.5, y: 14 });
    firstHit(battle, card, target);
  },
);

it("keeps the affordability tolerance at the reserve boundary", () => {
  const below = setup("x-bow", 8 - 1.1e-6);
  think(below);
  expect(below.actions).toEqual([]);
  const funded = setup("x-bow", 8 - 0.9e-6);
  think(funded);
  expect(funded.actions[0].card).toBe("x-bow");
});

it("returns to a real air response instead of continuing to save", () => {
  const battle = setup("x-bow", 6);
  think(battle);
  expect(battle.actions).toEqual([]);
  unit(battle, "baby-dragon", "blue", 4, 10).deploy = 0;
  expect(siegePlan(context(battle))).toBeUndefined();
  think(battle);
  expect(battle.actions[0].card).toBe("musketeer");
});

it("allows a known spell finisher while the siege is not yet funded", () => {
  const battle = setup("x-bow", 6);
  battle.players.red.hand = ["x-bow", "rocket", "golem", "three-musketeers"];
  battle.entities.find((entity) => entity.team === "blue" && entity.king)!.hp =
    20;
  think(battle);
  expect(battle.actions[0].card).toBe("rocket");
});

it("allows a ready Collector before waiting for a mirrored X-Bow", () => {
  const battle = setup("mirror", 8);
  battle.players.red.lastPlayed = "x-bow";
  battle.players.red.hand = ["mirror", "elixir-collector", "knight", "golem"];
  expect(siegePlan(context(battle))).toMatchObject({
    id: "mirror",
    requiredElixir: 9,
  });
  think(battle);
  expect(battle.actions[0].card).toBe("elixir-collector");
});

it.each([
  ["x-bow", "furnace", "furnace"],
  ["mortar", "barbarian-hut", "mortar"],
] as const)(
  "combines %s and %s plans without blocking the cheaper funded building",
  (siege, hut, expected) => {
    const battle = setup(siege, 6);
    battle.players.red.hand = [siege, hut, "knight", "golem"];
    think(battle);
    expect(battle.actions[0].card).toBe(expected);
    expect(battle.players.red.elixir).toBe(2);
  },
);

it("does not buy another same-card siege while the current one is deploying or alive", () => {
  const battle = setup(),
    existing = unit(battle, "x-bow", "red", 9, 10);
  expect(siegePlan(context(battle))).toBeUndefined();
  existing.hp = 0;
  expect(siegePlan(context(battle))).toBeDefined();
});

it("rejects an enemy ground screen but does not count hidden Tesla or air units as shot targets", () => {
  const battle = setup();
  const blocker = unit(battle, "tesla", "blue", 9, 18);
  Object.assign(blocker, {
    deploy: 0,
    burrow: { phase: "exposed", exposure: 1, idle: 0 },
  });
  expect(siegePlan(context(battle))).toBeUndefined();
  blocker.burrow!.phase = "hidden";
  expect(siegePlan(context(battle))).toBeDefined();
  unit(battle, "baby-dragon", "blue", 9, 22);
  expect(siegePlan(context(battle))).toBeDefined();
});

it("continues ordinary offense when the siege cannot acquire a Crown through a ground screen", () => {
  const battle = setup();
  unit(battle, "cannon", "blue", 9, 18);
  expect(siegePlan(context(battle))).toBeUndefined();
  think(battle);
  expect(CARD_MAP[battle.actions[0].card].kind).toBe("troop");
});

it("places Mortar outside its native blind spot instead of buying a nonfiring position", () => {
  const battle = setup("mortar", 6),
    target = crown(battle, "left");
  Object.assign(target, { x: 9, y: 14, hp: 100 });
  const plan = siegePlan(context(battle))!;
  expect(plan).toMatchObject({ target: target.id, point: { x: 3.5, y: 14 } });
  think(battle);
  const body = battle.entities.find((entity) => entity.card === "mortar")!;
  expect(
    Math.hypot(body.x - target.x, body.y - target.y),
  ).toBeGreaterThanOrEqual(minimumAttackDistance(body, target));
});

it("rejects blocked sites and Crowns outside every legal firing position", () => {
  const battle = setup();
  expect(siegePlan({ ...context(battle), legal: () => false })).toBeUndefined();
  for (const entity of battle.entities.filter(
    (entity) => entity.team === "blue" && entity.kind === "tower",
  ))
    entity.y = 31;
  expect(siegePlan(context(battle))).toBeUndefined();
});

it("tries another lane when an incoming Rocket covers the weaker Crown's firing positions", () => {
  const battle = setup(),
    left = crown(battle, "left"),
    right = crown(battle, "right");
  left.hp = 1000;
  const rocket: Projectile = {
    id: 100,
    team: "blue",
    x: 9,
    y: 29,
    tx: 3.5,
    ty: 14,
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
  expect(siegePlan(context(battle))!.target).toBe(right.id);
  rocket.team = "red";
  expect(siegePlan(context(battle))!.target).toBe(left.id);
});

it("avoids a Crown already covered by released projectile damage during deployment", () => {
  const battle = setup(),
    left = crown(battle, "left"),
    right = crown(battle, "right");
  left.hp = 10;
  battle.projectiles.push({
    id: 100,
    team: "red",
    x: 3.5,
    y: 14,
    tx: left.x,
    ty: left.y,
    target: left.id,
    damage: 32,
    remaining: 0.1,
    duration: 0.5,
    splash: 0,
    air: false,
    style: "x-bow",
    stun: 0,
    source: 99,
  });
  expect(siegePlan(context(battle))!.target).toBe(right.id);
});

it("reserves known Poison damage to a Crown rather than spending another building", () => {
  const battle = setup(),
    left = crown(battle, "left"),
    right = crown(battle, "right");
  left.hp = 10;
  battle.areas.push({
    id: 100,
    card: "poison",
    team: "red",
    x: left.x,
    y: left.y,
    radius: 3.5,
    duration: 8,
    remaining: 8,
  });
  expect(siegePlan(context(battle))!.target).toBe(right.id);
});

it.each(["x-bow", "mortar"] as const)(
  "%s keeps its validated open-lane position and actually hits the King",
  (card) => {
    const battle = setup(card, CARD_MAP[card].cost + 2);
    crown(battle, "left").hp = 0;
    const king = battle.entities.find(
      (entity) => entity.team === "blue" && entity.king,
    )!;
    const plan = siegePlan(context(battle))!;
    expect(plan).toMatchObject({ target: king.id, point: { x: 3.5, y: 18 } });
    think(battle);
    expect(battle.actions[0]).toMatchObject({ card, x: 3.5, y: 18 });
    firstHit(battle, card, king);
  },
);

it("values a reachable King in regulation and the weaker winning Crown in sudden death", () => {
  const battle = setup(),
    right = crown(battle, "right");
  crown(battle, "left").hp = 0;
  right.hp = 2800;
  const king = battle.entities.find(
    (entity) => entity.team === "blue" && entity.king,
  )!;
  expect(siegePlan(context(battle))!.target).toBe(king.id);
  expect(siegePlan({ ...context(battle), overtime: true })!.target).toBe(
    right.id,
  );
  expect(siegePlan({ ...context(battle), remaining: 11.99 })).toBeUndefined();
  expect(siegePlan({ ...context(battle), remaining: 12 })).toBeDefined();
});

it("uses Mirror's actual cost and leaves the defense reserve after its command", () => {
  const battle = setup("mirror", 8);
  battle.players.red.lastPlayed = "x-bow";
  think(battle);
  expect(battle.actions).toEqual([]);
  battle.players.red.elixir = 9;
  think(battle);
  expect(battle.actions[0].card).toBe("mirror");
  expect(battle.players.red.elixir).toBe(2);
});

it("mirrors target geometry exactly and leaves all state and RNG unchanged", () => {
  const battle = setup();
  crown(battle, "right").hp = 1000;
  const before = snapshot(battle),
    random = vi.spyOn(battle, "random");
  const plan = siegePlan(context(battle))!;
  const rotated = perspective(before, "red");
  expect(
    siegePlan({
      ...context(battle),
      team: "blue",
      entities: rotated.entities,
      projectiles: rotated.projectiles,
      areas: rotated.areas ?? [],
      legal: (card, point) =>
        battle.canPlace("red", card, 18 - point.x, 32 - point.y).ok,
    }),
  ).toEqual({ ...plan, point: { x: 18 - plan.point.x, y: 32 - plan.point.y } });
  expect(snapshot(battle)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
});

it.each(["Siege Engineer", "Mortar Marshal"])(
  "%s uses its siege card, hits a Crown and replays exactly",
  (name) => {
    const opponent = SOLO_OPPONENTS.find((opponent) => opponent.name === name)!;
    const card = name === "Siege Engineer" ? "x-bow" : "mortar";
    const battle = new Battle({ seed: 12, ai: true, enemyDeck: opponent.deck });
    let sawHit = false;
    for (let i = 0; i < 1200 && !battle.winner; i++) {
      battle.step();
      if (
        battle.events.some(
          (event) => event.type === "hit" && event.card === card,
        )
      )
        sawHit = true;
    }
    expect(sawHit).toBe(true);
    expect(battle.actions.some((action) => action.card === card)).toBe(true);
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
