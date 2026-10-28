import { beforeEach, describe, expect, it, vi } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import { recordedPractice } from "../src/game/match-decks";
import {
  loadProfile,
  recordBattle,
  validRecordEntry,
  exportProgress,
  importProgress,
} from "../src/game/profile";
import type { RecordEntry } from "../src/game/profile";
import { snapshot } from "../src/network/perspective";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";

const paces = ["training", "classic", "double"] as const;

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
  it.each(paces.flatMap((mode) => [false, true].map((red) => ({ mode, red }))))(
    "starts fresh $mode AI from the recorded opponent with red perspective $red",
    ({ mode, red }) => {
      const source = record(red),
        before = structuredClone(source),
        setup = recordedPractice(source, mode);
      const expected = red ? STARTER_DECK : PRESETS[1].deck;
      expect(setup).toMatchObject({
        name: source.opponent,
        mode,
        deck: expected,
      });
      const b = new Battle({
        ...setup,
        enemyDeck: setup.deck,
        deck: PRESETS[2].deck,
        seed: 7103,
      });
      for (let i = 0; i < 18 / STEP; i++) b.step();
      expect(b.mode).toBe(mode);
      expect(b.multiplier).toBe(mode === "double" ? 2 : 1);
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

  it.each(
    paces.flatMap((mode) =>
      (["blue", "red", "draw"] as const).map((winner) => ({ mode, winner })),
    ),
  )(
    "saves a new $mode/$winner practice result without trophies, gold or chests",
    ({ mode, winner }) => {
      const p = loadProfile(),
        source = record(true);
      p.history = [source];
      p.trophies = 234;
      p.best = 250;
      p.gold = 4321;
      p.chests = ["silver"];
      const before = structuredClone(p),
        setup = recordedPractice(source, mode);
      const b = new Battle({
        ...setup,
        enemyDeck: setup.deck,
        deck: p.deck,
        seed: 62,
      });
      b.finish(winner, "Practice complete");
      expect(
        recordBattle(p, b, {
          practice: true,
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
        practice: true,
        mode,
        opponent: source.opponent,
        opponentType: "ai",
        replay: { mode, deck: p.deck, enemyDeck: STARTER_DECK },
      });
      expect(p.history[0].matchId).toBeUndefined();
      expect(p.history[0].replay.perspective).toBeUndefined();
      expect(p.history[1]).toEqual(source);
      expect(loadProfile()).toEqual(p);
      expect(importProgress(exportProgress(p))).toEqual(p);
      expect(
        importReplayFile(exportReplayFile(p.history[0], p.name)).record,
      ).toMatchObject({ practice: true, mode });
    },
  );

  it.each(["classic", "double"] as const)(
    "keeps normal %s AI rewards and practice metadata separate",
    (mode) => {
      const p = loadProfile(),
        b = new Battle({ mode, ai: false, seed: 7 });
      b.finish("blue", "Normal battle");
      expect(recordBattle(p, b, { opponentType: "ai" })).toEqual({
        trophies: 30,
        gold: 125,
        chest: "silver",
      });
      expect(p.history[0].practice).toBeUndefined();
      expect(
        importReplayFile(exportReplayFile(p.history[0], p.name)).record
          .practice,
      ).toBeUndefined();
    },
  );

  it("rejects invalid practice metadata in progress and shared replay files", () => {
    const entry = record();
    for (const value of [false, "true", 1, null, {}]) {
      const corrupt = { ...entry, practice: value };
      expect(validRecordEntry(corrupt)).toBe(false);
      const file = JSON.parse(exportReplayFile(entry, "King"));
      file.match.practice = value;
      expect(() => importReplayFile(JSON.stringify(file))).toThrow("invalid");
      const p = loadProfile();
      p.history = [corrupt as never];
      expect(() => importProgress(exportProgress(p))).toThrow();
    }
    expect(validRecordEntry(entry)).toBe(true);
  });
});
