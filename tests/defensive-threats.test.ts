import { describe, expect, it, vi } from "vitest";
import { Battle, type Entity } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { defensiveThreats } from "../src/game/defensive-threats";
import { perspective, snapshot } from "../src/network/perspective";
const deck: CardId[] = [
  "mini-pekka",
  "knight",
  "giant",
  "hog-rider",
  "valkyrie",
  "cannon",
  "archers",
  "arrows",
];
function unit(
  b: Battle,
  card: CardId,
  x: number,
  y: number,
  extra: Partial<Entity> = {},
) {
  (b as any).spawn(card, "blue", x, y);
  const e = b.entities.at(-1)!;
  Object.assign(e, { deploy: 0 }, extra);
  return e;
}
const battle = () => new Battle({ seed: 8, ai: false, enemyDeck: deck });
const tower = (b: Battle, lane: "left" | "right") =>
  b.entities.find((e) => e.team === "red" && e.lane === lane)!;
function split() {
  const b = battle();
  const chip = unit(b, "skeletons", 4, 1, { hp: 1 });
  const hog = unit(b, "hog-rider", 14, 8);
  tower(b, "right").hp = 100;
  return { b, chip, hog };
}
function think(b: Battle) {
  b.players.red.hand = ["mini-pekka", "knight", "giant", "hog-rider"];
  b.players.red.elixir = 4;
  (b as any).think();
}

describe("visible defensive pressure", () => {
  it("prioritizes a healthy threat to a weak tower over a deeper one-hit body in the other lane", () => {
    const { b, hog } = split();
    expect(defensiveThreats("red", b.entities)[0]).toBe(hog);
    think(b);
    expect(b.actions.at(-1)).toMatchObject({
      card: "mini-pekka",
      team: "red",
      y: 9.3,
    });
    expect(b.actions.at(-1)!.x).toBeGreaterThan(13);
  });
  it("protects a King facing a lethal hit before a lethal Princess Tower attack", () => {
    const { b } = split();
    const king = b.entities.find((e) => e.team === "red" && e.king)!;
    king.hp = 80;
    const fatal = unit(b, "skeletons", 9, 3, { hp: 1, target: king.id });
    expect(defensiveThreats("red", b.entities)[0]).toBe(fatal);
  });
  it("discounts wounded attackers when distance and unit type match", () => {
    const b = battle();
    unit(b, "knight", 4, 10, { hp: 1 });
    const whole = unit(b, "knight", 14, 10);
    expect(defensiveThreats("red", b.entities)[0]).toBe(whole);
  });
  it("accounts for deployment, stun and time spent fighting an existing defender", () => {
    const b = battle();
    const delayed = unit(b, "knight", 4, 10, { deploy: 1, stun: 2 });
    const free = unit(b, "knight", 14, 10);
    expect(defensiveThreats("red", b.entities)[0]).toBe(free);
    delayed.deploy = 0;
    delayed.stun = 0;
    const guard = unit(b, "pekka", 4, 9, { team: "red" });
    delayed.target = guard.id;
    expect(defensiveThreats("red", b.entities)[0]).toBe(free);
  });
  it("ignores a destroyed Crown Tower when estimating the next threatened tower", () => {
    const b = battle();
    tower(b, "left").hp = 0;
    unit(b, "hog-rider", 4, 8);
    const liveLane = unit(b, "hog-rider", 14, 8);
    expect(defensiveThreats("red", b.entities)[0]).toBe(liveLane);
  });
  it("excludes dead, friendly, building and not-yet-crossed bodies without changing input or RNG", () => {
    const b = battle();
    const valid = unit(b, "knight", 4, 12);
    unit(b, "knight", 14, 8, { hp: 0 });
    unit(b, "knight", 4, 10, { team: "red" });
    unit(b, "cannon", 9, 10);
    unit(b, "knight", 14, 16);
    const before = structuredClone(b.entities),
      random = vi.spyOn(Math, "random").mockImplementation(() => {
        throw Error("RNG consumed");
      });
    try {
      expect(defensiveThreats("red", b.entities)).toEqual([valid]);
      expect(b.entities).toEqual(before);
    } finally {
      random.mockRestore();
    }
  });
  it("mirrors both the selected threat and ordering for a blue-side defender", () => {
    const { b } = split();
    unit(b, "minion-horde", 9, 12);
    const expected = defensiveThreats("red", b.entities).map((e) => e.id);
    expect(
      defensiveThreats("blue", perspective(snapshot(b), "red").entities).map(
        (e) => e.id,
      ),
    ).toEqual(expected);
  });
  it("keeps deterministic progress order when no living friendly Crown Towers remain", () => {
    const b = battle();
    for (const e of b.entities) e.hp = 0;
    const a = unit(b, "knight", 4, 11),
      c = unit(b, "knight", 14, 9);
    expect(defensiveThreats("red", b.entities)).toEqual([c, a]);
  });
  it("places a defender near a central attacker instead of at a fixed far-side lane center", () => {
    const b = battle();
    const enemy = unit(b, "knight", 9, 3);
    think(b);
    const play = b.actions.at(-1)!;
    expect(play.card).toBe("mini-pekka");
    expect(Math.hypot(play.x - enemy.x, play.y - enemy.y)).toBeLessThan(2);
    expect(play.y).toBeCloseTo(4.3);
    expect(b.players.red.elixir).toBe(0);
  });
  it.each([false, true])(
    "uses splash value from nearby hittable bodies (cluster=%s)",
    (cluster) => {
      const b = battle();
      tower(b, "right").hp = 100;
      unit(b, "hog-rider", 14, 8);
      for (let i = 0; i < 3; i++)
        unit(
          b,
          "skeletons",
          (cluster ? 14 : 4) + (i - 1) * 0.4,
          cluster ? 9 : 4,
        );
      b.players.red.hand = ["mini-pekka", "valkyrie", "giant", "hog-rider"];
      b.players.red.elixir = 4;
      const rng = vi.spyOn(b, "random").mockReturnValue(0);
      try {
        (b as any).think();
        expect(b.actions.at(-1)?.card).toBe(
          cluster ? "valkyrie" : "mini-pekka",
        );
      } finally {
        rng.mockRestore();
      }
    },
  );
  it("does not count an airborne cluster as splash value for a ground-only defender", () => {
    const b = battle();
    tower(b, "right").hp = 100;
    const hog = unit(b, "hog-rider", 14, 8);
    for (let i = 0; i < 3; i++)
      unit(b, "minions", 14 + (i - 1) * 0.3, 8.7, { hp: 1 });
    expect(defensiveThreats("red", b.entities)[0]).toBe(hog);
    b.players.red.hand = ["mini-pekka", "valkyrie", "giant", "hog-rider"];
    b.players.red.elixir = 4;
    const rng = vi.spyOn(b, "random").mockReturnValue(0);
    try {
      (b as any).think();
      expect(b.actions.at(-1)?.card).toBe("mini-pekka");
    } finally {
      rng.mockRestore();
    }
  });
  function swarm(b: Battle, card: CardId, count: number, hp?: number) {
    return Array.from({ length: count }, (_, i) => {
      const angle = i * 2.39996,
        spread = Math.sqrt(i) * 0.43;
      return unit(
        b,
        card,
        4 + Math.cos(angle) * spread,
        8 + Math.sin(angle) * spread,
        hp === undefined ? {} : { hp },
      );
    });
  }
  it.each([
    ["skeleton-army", 15, "valkyrie"],
    ["minion-horde", 6, "baby-dragon"],
  ] as const)(
    "treats a healthy %s push as more pressure than one isolated Hog and uses its local counter",
    (card, count, counter) => {
      const b = battle();
      swarm(b, card, count);
      unit(b, "hog-rider", 14, 8);
      expect(defensiveThreats("red", b.entities)[0].card).toBe(card);
      b.players.red.hand =
        card === "skeleton-army"
          ? ["mini-pekka", "valkyrie", "giant", "hog-rider"]
          : ["mini-pekka", "baby-dragon", "musketeer", "giant"];
      b.players.red.elixir = 4;
      (b as any).think();
      expect(b.actions.at(-1)?.card).toBe(counter);
      expect(b.actions.at(-1)!.x).toBeLessThan(7);
    },
  );
  it("does not join distant bodies through a chain of intermediate attackers", () => {
    const b = battle();
    for (const y of [1, 3.8, 6.6, 9.4, 12.2]) unit(b, "skeletons", 4, y);
    const hog = unit(b, "hog-rider", 14, 8);
    expect(defensiveThreats("red", b.entities)[0]).toBe(hog);
  });
  it("discounts a near-dead swarm rather than counting every body at full strength", () => {
    const b = battle();
    swarm(b, "minion-horde", 6, 1);
    const hog = unit(b, "hog-rider", 14, 8);
    expect(defensiveThreats("red", b.entities)[0]).toBe(hog);
  });
  it("keeps the actual lethal King attacker ahead of even a large lethal Princess Tower swarm", () => {
    const b = battle();
    tower(b, "left").hp = 1;
    for (let i = 0; i < 80; i++) unit(b, "skeleton-army", 4, 7.5);
    const king = b.entities.find((e) => e.team === "red" && e.king)!;
    king.hp = 80;
    const lethal = unit(b, "skeletons", 9, 4, { hp: 1, target: king.id });
    expect(defensiveThreats("red", b.entities)[0]).toBe(lethal);
  });
  it("keeps shared Tower pressure from masking a nearby immediate finishing attack on the other Tower", () => {
    const b = battle();
    swarm(b, "skeleton-army", 15);
    tower(b, "right").hp = 100;
    const hog = unit(b, "hog-rider", 14, 8);
    expect(defensiveThreats("red", b.entities)[0]).toBe(hog);
  });
  it("retains swarm ordering after view rotation without mutation or random draws", () => {
    const b = battle();
    swarm(b, "skeleton-army", 15);
    unit(b, "hog-rider", 14, 8);
    const before = structuredClone(b.entities);
    const expected = defensiveThreats("red", b.entities).map((e) => e.id);
    expect(
      defensiveThreats("blue", perspective(snapshot(b), "red").entities).map(
        (e) => e.id,
      ),
    ).toEqual(expected);
    expect(b.entities).toEqual(before);
  });
  it("retains one RNG score draw per affordable card and the original placement draw", () => {
    const { b } = split();
    b.players.red.hand = ["mini-pekka", "knight", "giant", "hog-rider"];
    b.players.red.elixir = 4;
    const rng = vi.spyOn(b, "random");
    (b as any).think();
    expect(rng).toHaveBeenCalledTimes(4);
    rng.mockRestore();
    expect(b.actions.at(-1)?.card).toBe("mini-pekka");
    expect(CARD_MAP[b.actions.at(-1)!.card].cost).toBe(4);
  });
});
