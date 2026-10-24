import { describe, expect, it, vi } from "vitest";
import { CARDS, CARD_MAP } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import {
  SOLO_OPPONENTS,
  soloOpponent,
  previousSoloOpponent,
} from "../src/game/opponents";
import { snapshot } from "../src/network/perspective";

describe("solo opponents", () => {
  it("covers the roster with legal, playable decks that cannot fill a hand with passive cards", () => {
    expect(new Set(SOLO_OPPONENTS.map((opponent) => opponent.name)).size).toBe(
      SOLO_OPPONENTS.length,
    );
    const covered = new Set<string>();
    for (const opponent of SOLO_OPPONENTS) {
      expect(new Set(opponent.deck).size).toBe(8);
      for (const id of opponent.deck) {
        expect(CARD_MAP[id]).toBeDefined();
        covered.add(id);
      }
      expect(
        opponent.deck.filter((id) => CARD_MAP[id].kind !== "troop").length,
      ).toBeLessThan(4);
      expect(
        opponent.deck.some((id) => CARD_MAP[id].hitsAir || CARD_MAP[id].air),
      ).toBe(true);
      expect(() => new Battle({ enemyDeck: [...opponent.deck] })).not.toThrow();
    }
    expect([...covered].sort()).toEqual(CARDS.map((card) => card.id).sort());
  });

  it("selects every archetype deterministically without consuming gameplay or browser randomness", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Unexpected random draw");
    });
    try {
      const names = new Set<string>();
      for (let seed = 1; seed <= 100; seed++) {
        const first = soloOpponent(seed, "classic");
        expect(soloOpponent(seed, "classic")).toEqual(first);
        expect(soloOpponent(seed, "double")).toEqual(first);
        names.add(first.name);
      }
      expect(names.size).toBe(SOLO_OPPONENTS.length);
    } finally {
      random.mockRestore();
    }
  });

  it("avoids the previous named AI and returns independent deck copies", () => {
    for (let seed = 1; seed <= 30; seed++)
      for (const previous of SOLO_OPPONENTS)
        expect(soloOpponent(seed, "classic", previous.name).name).not.toBe(
          previous.name,
        );
    const chosen = soloOpponent(8, "classic");
    const original = [...chosen.deck];
    chosen.deck[0] = "rage";
    expect(soloOpponent(8, "classic").deck).toEqual(original);
    expect(soloOpponent(8, "classic", "A human friend")).toEqual(
      soloOpponent(8, "classic"),
    );
  });

  it("keeps Training on the original, slower opponent", () => {
    for (const seed of [1, 17, 42, 2147483646])
      expect(soloOpponent(seed, "training", "Royal Trainer")).toEqual(
        SOLO_OPPONENTS[0],
      );
    const b = new Battle({
      seed: 1,
      mode: "training",
      enemyDeck: soloOpponent(1, "training").deck,
    });
    for (let i = 0; i < 74; i++) b.step();
    expect(b.actions).toEqual([]);
  });

  it("recognizes legacy solo history and skips friendly matches when finding the previous AI", () => {
    expect(previousSoloOpponent([])).toBeUndefined();
    expect(
      previousSoloOpponent([{ opponent: "A friend", matchId: "room" }, {}]),
    ).toBe("Royal Trainer");
    expect(
      previousSoloOpponent([
        { opponentType: "friend", opponent: "Royal Trainer" },
        { opponentType: "ai", opponent: "Sky Captain" },
        {},
      ]),
    ).toBe("Sky Captain");
    expect(
      previousSoloOpponent([{ opponent: "Legacy friend" }]),
    ).toBeUndefined();
    for (let seed = 1; seed <= 30; seed++)
      expect(
        soloOpponent(seed, "classic", previousSoloOpponent([{}])).name,
      ).not.toBe("Royal Trainer");
  });

  it("places a cycled defensive building beside its occupied preferred tile", () => {
    const b = new Battle({ seed: 8, ai: false });
    b.players.red.hand[0] = "cannon";
    b.players.red.elixir = 10;
    expect(b.play("red", 0, 9, 10).ok).toBe(true);
    b.players.blue.hand[0] = "giant";
    b.players.blue.elixir = 10;
    expect(b.play("blue", 0, 9, 22).ok).toBe(true);
    const giant = b.entities.find((e) => e.card === "giant")!;
    giant.y = 12;
    giant.deploy = 0;
    // Keep alternatives unattractive so this isolates occupied-tile fallback.
    b.players.red.hand = ["cannon", "poison", "poison", "poison"];
    b.players.red.elixir = 10;
    expect(b.canPlace("red", "cannon", 9, 10).ok).toBe(false);
    (b as unknown as { think: () => void }).think();
    expect(b.actions.at(-1)).toMatchObject({
      team: "red",
      card: "cannon",
      x: 6.5,
      y: 10,
    });
    expect(b.entities.filter((e) => e.card === "cannon")).toHaveLength(2);
    expect(b.players.red.elixir).toBe(7);
  });

  for (const [index, opponent] of SOLO_OPPONENTS.entries())
    it(`${opponent.style} resolves a legal full battle and replays its entire outcome`, () => {
      const b = new Battle({ seed: 37 + index, enemyDeck: [...opponent.deck] });
      while (!b.winner) {
        if (b.tick % 90 === 0) {
          for (let slot = 0; slot < 4; slot++) {
            const id = b.players.blue.hand[slot],
              card = CARD_MAP[id];
            const lane = Math.floor(b.tick / 180) % 2 === 0 ? 4 : 14;
            const point =
              card.kind === "spell" ? { x: lane, y: 10 } : { x: lane, y: 23 };
            if (b.play("blue", slot, point.x, point.y).ok) break;
          }
        }
        b.step();
        expect(b.players.red.elixir).toBeGreaterThanOrEqual(0);
        expect(b.players.red.elixir).toBeLessThanOrEqual(10);
        expect(b.tick).toBeLessThanOrEqual(9000);
      }
      const actions = b.actions.filter((action) => action.team === "red");
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(opponent.deck).toContain(action.card);
        expect(action.x).toBeGreaterThanOrEqual(0.5);
        expect(action.x).toBeLessThanOrEqual(17.5);
        expect(action.y).toBeGreaterThanOrEqual(0.6);
        expect(action.y).toBeLessThanOrEqual(31.4);
      }
      expect(b.exportReplay().enemyDeck).toEqual(opponent.deck);
      const replay = new Battle({ replay: b.exportReplay() });
      while (replay.tick < b.tick) replay.step();
      expect(snapshot(replay)).toEqual(snapshot(b));
      expect(replay.audioEvents).toEqual(b.audioEvents);
    });
});
