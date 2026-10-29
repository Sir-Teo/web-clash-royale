import { expect, it, vi } from "vitest";
import { Battle, type Entity } from "../src/game/engine";
import { minerInterceptTarget } from "../src/game/miner-intercept";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { COMBAT_STEP } from "../src/game/combat";
import { impactSteps } from "../src/game/projectile-impacts";
import { perspective, snapshot } from "../src/network/perspective";
import miner from "../src/game/miner-data.json" with { type: "json" };

interface SceneOptions {
  start?: number;
  king?: boolean;
  raged?: boolean;
  artillery?: boolean;
  version?: 55 | 56;
}
function scene({
  start = 14.2,
  king = false,
  raged = false,
  artillery = false,
  version = 56,
}: SceneOptions = {}) {
  const seed = 8;
  const b =
    version === 56
      ? new Battle({ seed, ai: false })
      : new Battle({
          replay: {
            ...new Battle({ seed, ai: false }).exportReplay(),
            version,
          },
        });
  if (version === 55)
    Object.assign(b, { replayActions: null, replayDuration: undefined });
  for (const tower of b.entities) tower.active = artillery && !tower.king;
  if (king) {
    b.entities.find((e) => e.team === "red" && e.lane === "right")!.hp = 0;
    b.entities.find((e) => e.team === "red" && e.king)!.active = artillery;
  }
  (b as any).spawn("hog-rider", "blue", 14.5, start);
  const hog = b.entities.at(-1)!;
  hog.deploy = 0;
  if (raged) hog.rage = { remaining: 5 };
  b.players.red.hand = ["miner", "pekka", "pekka", "pekka"];
  b.players.red.elixir = 3;
  return { b, hog };
}
const legal = (b: Battle) => (p: { x: number; y: number }) =>
  b.canPlace("red", "miner", p.x, p.y).ok;
const plan = (b: Battle, hog: Entity) =>
  minerInterceptTarget("red", hog, b.entities, legal(b), b.areas);
const think = (b: Battle) => (b as any).think();
function result(b: Battle) {
  const towers = b.entities
    .filter((e) => e.team === "red" && e.kind === "tower" && e.hp > 0)
    .map((e) => ({ id: e.id, hp: e.hp }));
  let firstMiner = Infinity,
    firstHog = Infinity,
    arrival = Infinity;
  for (let i = 0; i < 300 && !b.winner; i++) {
    b.step();
    if (b.entities.some((e) => e.team === "red" && e.card === "miner"))
      arrival = Math.min(arrival, b.time);
    if (b.events.some((e) => e.type === "hit" && e.card === "miner"))
      firstMiner = Math.min(firstMiner, b.time);
    if (b.events.some((e) => e.type === "hit" && e.card === "hog-rider"))
      firstHog = Math.min(firstHog, b.time);
  }
  return {
    arrival,
    firstMiner,
    firstHog,
    damage: towers.reduce(
      (damage, tower) =>
        damage +
        tower.hp -
        (b.entities.find((e) => e.id === tower.id)?.hp ?? 0),
      0,
    ),
  };
}

for (const king of [false, true])
  for (const raged of [false, true])
    it.each([10, 12, 14.2])(
      `includes the tunnel against a ${raged ? "raged" : "normal"} Hog on the ${king ? "King" : "Princess"} route from row %s`,
      (start) => {
        const options = { king, raged, start },
          before = scene(options),
          after = scene(options);
        const old = meleeInterceptTarget(
          "miner",
          "red",
          before.hog,
          before.b.entities,
          legal(before.b),
        )!;
        expect(before.b.play("red", 0, old.x, old.y).ok).toBe(true);
        const point = plan(after.b, after.hog)!;
        expect(point).toBeDefined();
        think(after.b);
        expect(after.b.actions[0]).toMatchObject({ card: "miner", ...point });
        expect(after.b.players.red.elixir).toBe(0);
        expect(after.b.entities.some((e) => e.card === "miner")).toBe(false);
        const oldResult = result(before.b),
          current = result(after.b);
        expect(current.arrival).toBeCloseTo(
          impactSteps(
            Math.hypot(point.x - 9, point.y - 3) / miner.travelSpeed,
          ) * COMBAT_STEP,
          10,
        );
        expect(current.firstMiner).toBeGreaterThan(current.arrival + 1);
        expect(current.firstMiner).toBeLessThanOrEqual(oldResult.firstMiner);
        expect(current.damage).toBeLessThanOrEqual(oldResult.damage);
        if (king || start === 14.2) {
          expect(current.firstMiner).toBeLessThan(current.firstHog);
          expect(current.damage).toBe(0);
          expect(current.damage).toBeLessThan(oldResult.damage);
        }
        expect(
          after.b.events.find((e) => e.type === "hit" && e.card === "miner")
            ?.value,
        ).toBe(CARD_MAP.miner.damage);
      },
    );

it.each([false, true])(
  "protects a live firing Princess against the %s-Rage approach",
  (raged) => {
    const before = scene({ raged, artillery: true }),
      after = scene({ raged, artillery: true });
    const point = meleeInterceptTarget(
      "miner",
      "red",
      before.hog,
      before.b.entities,
      legal(before.b),
    )!;
    before.b.play("red", 0, point.x, point.y);
    think(after.b);
    const baseline = result(before.b),
      current = result(after.b);
    expect(current.firstMiner).toBeLessThan(baseline.firstMiner);
    expect(current.damage).toBeLessThan(baseline.damage);
    expect(current.damage).toBe(0);
  },
);

it("keeps its legal lead within one step of the actual tunnel's arrival clock", () => {
  const { b, hog } = scene({ king: true, raged: true });
  const point = plan(b, hog)!;
  const flight =
    impactSteps(Math.hypot(point.x - 9, point.y - 3) / miner.travelSpeed) *
    COMBAT_STEP;
  const atArrival = meleeInterceptTarget(
    "miner",
    "red",
    hog,
    b.entities,
    legal(b),
    b.areas,
    flight,
  )!;
  expect(
    Math.hypot(point.x - atArrival.x, point.y - atArrival.y),
  ).toBeLessThanOrEqual(hog.speed * 1.35 * COMBAT_STEP + 1e-8);
});

it("uses a legal lateral landing and rejects an entirely occupied forecast", () => {
  const { b, hog } = scene();
  const point = minerInterceptTarget(
    "red",
    hog,
    b.entities,
    (p) => legal(b)(p) && p.x !== hog.x,
  )!;
  expect(point.x).not.toBe(hog.x);
  expect(legal(b)(point)).toBe(true);
  expect(
    minerInterceptTarget("red", hog, b.entities, () => false),
  ).toBeUndefined();
});

it("accounts for stun expiring during the tunnel without adding concurrent deployment twice", () => {
  const { b, hog } = scene();
  hog.stun = 2;
  hog.deploy = 2;
  expect(
    meleeInterceptTarget("miner", "red", hog, b.entities, legal(b)),
  ).toBeUndefined();
  const point = plan(b, hog)!;
  expect(point.y).toBeLessThan(hog.y);
  const concurrent = { ...hog, deploy: 0 };
  expect(plan(b, concurrent)).toEqual(point);
});

it("does not invent tunnel waiting time to forecast past a long Freeze", () => {
  const { b, hog } = scene();
  b.areas.push({
    id: 100,
    card: "freeze",
    team: "red",
    x: hog.x,
    y: hog.y,
    radius: 3,
    remaining: 4,
    duration: 4,
  });
  expect(plan(b, hog)).toBeUndefined();
  b.areas[0].remaining = 2;
  expect(plan(b, hog)).toBeDefined();
});

it("uses only the current surviving Rage and slow intervals", () => {
  const { b, hog } = scene();
  hog.rage = { remaining: 0.5 };
  hog.slow = { remaining: 0.25 };
  const point = plan(b, hog)!;
  expect(point.y).toBeLessThan(11);
  const before = snapshot(b);
  expect(plan(b, hog)).toEqual(point);
  expect(snapshot(b)).toEqual(before);
});

it.each(["rage", "freeze"] as const)(
  "defends through a real %s area without changing the spell or combat rules",
  (card) => {
    const before = scene({ version: 55 }),
      after = scene();
    for (const { b, hog } of [before, after]) {
      const team = card === "rage" ? "blue" : "red";
      b.players[team].elixir = 10;
      b.players[team].hand[0] = card;
      expect(b.play(team, 0, hog.x, hog.y).ok).toBe(true);
      if (card === "freeze")
        b.areas.find((area) => area.card === card)!.remaining = 2;
      b.step();
      b.players.red.hand = ["miner", "pekka", "pekka", "pekka"];
      b.players.red.elixir = 3;
      think(b);
    }
    const baseline = result(before.b),
      current = result(after.b);
    expect(current.firstMiner).toBeLessThan(baseline.firstMiner);
    expect(current.damage).toBeLessThan(baseline.damage);
    expect(current.damage).toBe(0);
  },
);

it.each([
  "inactive",
  "stationary",
  "attacking",
  "normal-target",
  "bridge-route",
  "air",
])("retains ordinary placement for a %s target", (state) => {
  const { b, hog } = scene();
  if (state === "inactive") hog.active = false;
  if (state === "stationary") hog.speed = 0;
  if (state === "attacking") hog.y = 7.8;
  if (state === "normal-target") hog.card = "knight";
  if (state === "bridge-route") {
    hog.card = "giant";
    hog.y = 14.9;
  }
  if (state === "air") hog.air = true;
  const available = vi.fn(legal(b));
  expect(
    minerInterceptTarget("red", hog, b.entities, available),
  ).toBeUndefined();
  expect(available).not.toHaveBeenCalled();
});

it("uses the resolved Miner tunnel and actual cost for a defensive Mirror", () => {
  const { b, hog } = scene({ raged: true });
  b.players.red.hand[0] = "mirror";
  b.players.red.lastPlayed = "miner";
  b.players.red.elixir = 4;
  const point = plan(b, hog)!;
  think(b);
  expect(b.actions[0]).toMatchObject({ card: "mirror", ...point });
  expect(b.players.red.elixir).toBe(0);
  const defended = result(b);
  expect(defended.damage).toBe(0);
  expect(defended.firstMiner).toBeLessThan(defended.firstHog);
});

it("mirrors a diagonal approach without advancing state or consuming extra decision RNG", () => {
  const { b, hog } = scene({ king: true, raged: true });
  const before = snapshot(b),
    random = vi.spyOn(b, "random");
  const point = plan(b, hog)!,
    rotated = perspective(before, "red");
  const blue = minerInterceptTarget(
    "blue",
    rotated.entities.find((e) => e.id === hog.id)!,
    rotated.entities,
    (p) => legal(b)({ x: 18 - p.x, y: 32 - p.y }),
    rotated.areas ?? [],
  )!;
  expect(blue.x).toBeCloseTo(18 - point.x, 12);
  expect(blue.y).toBeCloseTo(32 - point.y, 12);
  expect(snapshot(b)).toEqual(before);
  expect(random).not.toHaveBeenCalled();
  think(b);
  expect(random).toHaveBeenCalledTimes(2);
});

it("preserves the earlier AI's Miner placement while current games include the tunnel", () => {
  const old = scene({ version: 55 }),
    current = scene();
  const expected = meleeInterceptTarget(
    "miner",
    "red",
    old.hog,
    old.b.entities,
    legal(old.b),
  )!;
  think(old.b);
  think(current.b);
  expect(old.b.actions[0]).toMatchObject({ ...expected, x: 14.5, y: 11.2 });
  expect(current.b.actions[0]).toMatchObject({ x: 14.5, y: 9.6 });
  expect(result(old.b).damage).toBeGreaterThan(0);
  expect(result(current.b).damage).toBe(0);
});

it("defends a legal opening through the ordinary AI timer and reconstructs its replay", () => {
  const deck: CardId[] = [
    "hog-rider",
    "knight",
    "archers",
    "skeletons",
    "goblins",
    "fireball",
    "zap",
    "cannon",
  ];
  const enemyDeck: CardId[] = [
    "miner",
    "pekka",
    "three-musketeers",
    "golem",
    "rocket",
    "lightning",
    "freeze",
    "balloon",
  ];
  const b = new Battle({ seed: 73, deck, enemyDeck, ai: true });
  expect(b.players.red.hand).toContain("miner");
  expect(
    b.play("blue", b.players.blue.hand.indexOf("hog-rider"), 14.5, 18).ok,
  ).toBe(true);
  let hit = false;
  for (let i = 0; i < 900 && !b.winner; i++) {
    b.step();
    if (
      b.events.some(
        (e) => e.type === "hit" && e.card === "miner" && e.team === "red",
      )
    )
      hit = true;
  }
  const defense = b.actions.find((a) => a.team === "red")!;
  expect(defense).toMatchObject({ card: "miner", x: 14.5, y: 8.9 });
  expect(defense.tick).toBe(134);
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
});
