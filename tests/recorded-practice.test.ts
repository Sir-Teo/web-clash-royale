import { beforeEach, describe, expect, it, vi } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import { recordedPractice } from "../src/game/match-decks";
import { loadProfile, recordBattle } from "../src/game/profile";
import type { RecordEntry } from "../src/game/profile";
import { snapshot } from "../src/network/perspective";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
function record(red = false): RecordEntry {
  const b = new Battle({
    seed: 8,
    mode: "double",
    ai: false,
    enemyDeck: PRESETS[1].deck,
  });
  return {
    id: 1,
    date: "2026-10-24T12:00:00.000Z",
    winner: "red",
    crowns: [0, 0],
    mode: b.mode,
    opponent: "<b>Recorded & King</b>",
    opponentType: "friend",
    matchId: "old-friend-round",
    replay: { ...b.exportReplay(), ...(red ? { perspective: "red" } : {}) },
  };
}

describe("practice against a recorded deck", () => {
  it.each([false, true])(
    "starts fresh Training AI from the recorded opponent with red perspective %s",
    (red) => {
      const source = record(red),
        before = structuredClone(source),
        setup = recordedPractice(source);
      const expected = red ? STARTER_DECK : PRESETS[1].deck;
      expect(setup).toMatchObject({
        name: source.opponent,
        mode: "training",
        deck: expected,
      });
      const b = new Battle({
        ...setup,
        enemyDeck: setup.deck,
        deck: PRESETS[2].deck,
        seed: 7103,
      });
      for (let i = 0; i < 18 / STEP; i++) b.step();
      expect(b.mode).toBe("training");
      expect(b.seed).toBe(7103);
      expect(b.deck).toEqual(PRESETS[2].deck);
      expect(b.enemyDeck).toEqual(expected);
      expect(b.actions.length).toBeGreaterThan(0);
      expect(
        b.actions.every((a) => a.team === "red" && expected.includes(a.card)),
      ).toBe(true);
      const replay = b.exportReplay(),
        playback = new Battle({ replay });
      while (playback.tick < replay.duration) playback.step();
      expect(snapshot(playback)).toEqual(snapshot(b));
      expect(source).toEqual(before);
    },
  );

  it("clones the opponent deck, uses the legacy name fallback and accepts all historical rules versions", () => {
    const source = record();
    delete source.opponent;
    const before = structuredClone(source);
    const setup = recordedPractice(source);
    setup.deck[0] = "rage";
    expect(source).toEqual(before);
    for (const version of [1, 2, 3, 4, 5] as const) {
      source.replay.version = version;
      expect(recordedPractice(source)).toMatchObject({
        name: "Royal Trainer",
        deck: PRESETS[1].deck,
        mode: "training",
      });
    }
  });

  it("rejects a corrupt opponent deck without changing its recording", () => {
    const source = record(true);
    source.replay.deck[0] = "constructor" as never;
    const before = structuredClone(source);
    expect(() => recordedPractice(source)).toThrow("valid opponent deck");
    expect(source).toEqual(before);
  });

  it.each(["blue", "red", "draw"] as const)(
    "saves a new %s Training result without trophies, gold or chests",
    (winner) => {
      const p = loadProfile(),
        source = record(true);
      p.history = [source];
      p.trophies = 234;
      p.best = 250;
      p.gold = 4321;
      p.chests = ["silver"];
      const before = structuredClone(p),
        setup = recordedPractice(source);
      const b = new Battle({
        ...setup,
        enemyDeck: setup.deck,
        deck: p.deck,
        seed: 62,
      });
      b.finish(winner, "Practice complete");
      expect(
        recordBattle(p, b, {
          opponent: setup.name,
          opponentType: "ai",
          playerName: p.name,
        }),
      ).toEqual({ trophies: 0, gold: 0, chest: null });
      for (const key of [
        "trophies",
        "best",
        "gold",
        "chests",
        "deck",
        "decks",
        "activeDeck",
      ] as const)
        expect(p[key]).toEqual(before[key]);
      expect(p.battles).toBe(before.battles + 1);
      expect(p.wins).toBe(before.wins + (winner === "blue" ? 1 : 0));
      expect(p.history[0]).toMatchObject({
        mode: "training",
        opponent: source.opponent,
        opponentType: "ai",
        replay: { mode: "training", deck: p.deck, enemyDeck: STARTER_DECK },
      });
      expect(p.history[0].matchId).toBeUndefined();
      expect(p.history[0].replay.perspective).toBeUndefined();
      expect(p.history[1]).toEqual(source);
      expect(loadProfile()).toEqual(p);
    },
  );
});
