import { attackReach } from "../src/game/attack-range";
import { describe, expect, it, vi } from "vitest";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { perspective, snapshot } from "../src/network/perspective";
import type { CardId } from "../src/game/cards";
import { Battle } from "../src/game/engine";
function scene(start: number) {
  const b = new Battle({ seed: 8, ai: false });
  // Isolate the guard's interception from tower artillery, retaining real target movement.
  for (const tower of b.entities) tower.active = false;
  (b as any).spawn("hog-rider", "blue", 14, start);
  const hog = b.entities.at(-1)!;
  hog.deploy = 0;
  b.players.red.hand = ["mini-pekka", "giant", "pekka", "three-musketeers"];
  b.players.red.elixir = 4;
  return { b, hog };
}
describe("AI moving building-seeker interception", () => {
  it.each([11, 12, 13, 14])(
    "gets a melee hit before a moving Hog reaches the tower from row %s",
    (start) => {
      const { b } = scene(start);
      (b as any).think();
      expect(b.actions[0]?.card).toBe("mini-pekka");
      let firstGuard = Infinity,
        firstHog = Infinity;
      for (let i = 0; i < 210; i++) {
        b.step();
        if (b.events.some((e) => e.type === "hit" && e.card === "mini-pekka"))
          firstGuard = Math.min(firstGuard, b.time);
        if (b.events.some((e) => e.type === "hit" && e.card === "hog-rider"))
          firstHog = Math.min(firstHog, b.time);
      }
      expect(firstGuard).toBeLessThan(1.8);
      expect(firstGuard).toBeLessThan(firstHog);
      const unguarded = scene(start).b;
      let unguardedFirstHit = Infinity;
      for (let i = 0; i < 210; i++) {
        unguarded.step();
        if (unguarded.events.some((e) => e.type === "hit" && e.card === "hog-rider"))
          unguardedFirstHit = Math.min(unguardedFirstHit, unguarded.time);
      }
      const towerDamage = (battle: Battle) => battle.entities
        .filter((e) => e.team === "red" && e.kind === "tower")
        .reduce((sum, e) => sum + e.maxHp - e.hp, 0);
      expect(firstHog).toBeGreaterThan(unguardedFirstHit);
      expect(towerDamage(b)).toBeLessThan(towerDamage(unguarded));
      expect(b.entities.some((e) => e.card === "hog-rider")).toBe(false);
    },
  );
});

const intercept = (b: Battle, card: CardId, threat = b.entities.at(-1)!) =>
  meleeInterceptTarget(
    card,
    "red",
    threat,
    b.entities,
    (p) => b.canPlace("red", card, p.x, p.y).ok,
  );
describe("bounded melee interception forecast", () => {
  it("mirrors a diagonal King approach without mutating entities or drawing randomness", () => {
    const { b, hog } = scene(13);
    b.entities.find((e) => e.team === "red" && e.lane === "right")!.hp = 0;
    const before = structuredClone(b.entities);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw Error("RNG consumed");
    });
    try {
      const red = intercept(b, "mini-pekka", hog)!;
      expect(red.x).toBeLessThan(hog.x);
      expect(red.y).toBeLessThan(hog.y);
      const mirrored = perspective(snapshot(b), "red").entities;
      const blue = meleeInterceptTarget(
        "mini-pekka",
        "blue",
        mirrored.find((e) => e.id === hog.id)!,
        mirrored,
        () => true,
      )!;
      expect(blue.x).toBeCloseTo(18 - red.x);
      expect(blue.y).toBeCloseTo(32 - red.y);
      expect(b.entities).toEqual(before);
    } finally {
      random.mockRestore();
    }
  });
  it("uses a visible defensive building when it intercepts the runner's path", () => {
    const { b, hog } = scene(13);
    (b as any).spawn("cannon", "red", 11, 11);
    const target = b.entities.at(-1)!;
    hog.target = target.id;
    const point = intercept(b, "mini-pekka", hog)!;
    expect(point.x).toBeLessThan(hog.x);
    expect(point.y).toBeLessThan(hog.y);
    expect(
      Math.hypot(point.x - target.x, point.y - target.y),
    ).toBeGreaterThanOrEqual(
      attackReach(hog, target) - 1e-9,
    );
  });
  it("never forecasts past the attack ring or onto a destroyed/hidden building", () => {
    const { b, hog } = scene(11);
    (b as any).spawn("tesla", "red", 14, 10);
    const buried = b.entities.at(-1)!;
    buried.deploy = 0;
    const point = intercept(b, "mini-pekka", hog)!;
    expect(point.y).toBeLessThan(9);
    const tower = b.entities.find(
      (e) => e.team === "red" && e.lane === "right",
    )!;
    expect(point.y).toBeGreaterThanOrEqual(
      tower.y + attackReach(hog, tower) - 1e-9,
    );
    tower.hp = 0;
    const next = intercept(b, "mini-pekka", hog)!;
    expect(next.x).not.toBe(14);
  });
  it("counts concurrent stun and deployment once and includes only the surviving Rage interval", () => {
    const { b, hog } = scene(14);
    hog.stun = 0.5;
    hog.deploy = 0.5;
    hog.rage = { remaining: 1 };
    const point = intercept(b, "mini-pekka", hog)!;
    expect(point.y).toBeCloseTo(14 - hog.speed * (1 + 0.5 * 0.35));
  });
  it("waits for a known Freeze area to release the attacker", () => {
    const { b, hog } = scene(14);
    const area = {
      id: 100,
      card: "freeze" as const,
      team: "red" as const,
      x: 14,
      y: 14,
      radius: 3,
      duration: 4,
      remaining: 4,
    };
    const target = () =>
      meleeInterceptTarget("mini-pekka", "red", hog, b.entities, () => true, [
        area,
      ]);
    expect(target()).toBeUndefined();
    area.remaining = 0.5;
    expect(target()?.y).toBeCloseTo(14 - hog.speed);
    expect(area.remaining).toBe(0.5);
  });
  it("uses a legal lateral alternative and holds no illegal forecast when all candidates are blocked", () => {
    const { b, hog } = scene(13);
    const expected = intercept(b, "mini-pekka", hog)!;
    const point = meleeInterceptTarget(
      "mini-pekka",
      "red",
      hog,
      b.entities,
      (p) => p.x !== expected.x,
    )!;
    expect(point.x).not.toBe(expected.x);
    expect(point.y).toBeCloseTo(expected.y);
    expect(
      meleeInterceptTarget("mini-pekka", "red", hog, b.entities, () => false),
    ).toBeUndefined();
  });
  it.each([
    "inactive",
    "stationary",
    "stunned",
    "attacking",
    "normal-target",
    "river-route",
  ])("keeps the ordinary placement for a %s attacker", (state) => {
    const { b, hog } = scene(13);
    if (state === "inactive") hog.active = false;
    if (state === "stationary") hog.speed = 0;
    if (state === "stunned") hog.stun = 2;
    if (state === "attacking") {
      hog.y = 7.8;
      hog.target = b.entities.find(
        (e) => e.team === "red" && e.lane === "right",
      )!.id;
    }
    if (state === "normal-target") hog.card = "knight";
    if (state === "river-route") {
      hog.card = "giant";
      hog.y = 14.9;
    }
    expect(intercept(b, "mini-pekka", hog)).toBeUndefined();
  });
  it.each(["musketeer", "cannon", "giant", "fireball"] as CardId[])(
    "retains the existing ranged/building/offense/spell policy for %s",
    (card) => {
      const { b, hog } = scene(13);
      expect(intercept(b, card, hog)).toBeUndefined();
    },
  );
  it.each([18, 20])(
    "does not forecast a Giant's bridge approach from row %s as a straight path to its tower",
    (start) => {
      const { b } = scene(start);
      (b as any).spawn("giant", "blue", 9, start);
      const giant = b.entities.at(-1)!;
      giant.deploy = 0;
      const legal = vi.fn(() => true);
      expect(
        meleeInterceptTarget("mini-pekka", "red", giant, b.entities, legal),
      ).toBeUndefined();
      expect(legal).not.toHaveBeenCalled();
    },
  );
  it("uses the legal forecast in an opened lane without clamping it back to the home half", () => {
    const { b, hog } = scene(14.9);
    b.entities.find((e) => e.team === "blue" && e.lane === "right")!.hp = 0;
    (b as any).spawn("cannon", "red", 14, 20.5);
    hog.target = b.entities.at(-1)!.id;
    const expected = intercept(b, "mini-pekka", hog)!;
    expect(expected.y).toBeGreaterThan(17.5);
    (b as any).think();
    expect(b.actions[0]).toMatchObject({ card: "mini-pekka", ...expected });
    expect(b.canPlace("red", "mini-pekka", expected.x, expected.y).ok).toBe(
      true,
    );
  });
  it("preserves the ordinary affordable-card and placement RNG budget", () => {
    const { b } = scene(13);
    const random = vi.spyOn(b, "random");
    (b as any).think();
    expect(random).toHaveBeenCalledTimes(2);
    random.mockRestore();
    expect(b.actions[0]).toMatchObject({ x: 14, y: 10 });
  });
});

it("intercepts a legal opening through the ordinary AI timer and reconstructs its replay", () => {
  const deck: CardId[] = [
    "hog-rider",
    "knight",
    "archers",
    "musketeer",
    "skeletons",
    "goblins",
    "arrows",
    "fireball",
  ];
  const enemyDeck: CardId[] = [
    "mini-pekka",
    "giant",
    "pekka",
    "three-musketeers",
    "prince",
    "wizard",
    "witch",
    "balloon",
  ];
  let b: Battle | undefined;
  for (let seed = 1; seed <= 1000; seed++) {
    const candidate = new Battle({ seed, deck, enemyDeck });
    if (
      candidate.players.blue.hand.includes("hog-rider") &&
      candidate.players.red.hand.every((id) =>
        ["mini-pekka", "giant", "pekka", "three-musketeers"].includes(id),
      )
    ) {
      b = candidate;
      break;
    }
  }
  expect(b).toBeDefined();
  const game = b!;
  expect(
    game.play("blue", game.players.blue.hand.indexOf("hog-rider"), 14, 17.8).ok,
  ).toBe(true);
  for (let i = 0; i < 240; i++) game.step();
  expect(
    game.actions.some((a) => a.team === "red" && a.card === "mini-pekka"),
  ).toBe(true);
  expect(
    game.events.some((e) => e.type === "hit" && e.card === "mini-pekka"),
  ).toBe(true);
  expect(
    game.entities
      .filter((e) => e.team === "red" && e.kind === "tower")
      .every((e) => e.hp === e.maxHp),
  ).toBe(true);
  const replay = game.exportReplay(),
    rebuilt = new Battle({ replay });
  while (rebuilt.tick < replay.duration) rebuilt.step();
  expect(snapshot(rebuilt)).toEqual(snapshot(game));
});
