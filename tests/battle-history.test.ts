import { describe, expect, it } from "vitest";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import type { Replay } from "../src/game/engine";
import type { RecordEntry } from "../src/game/profile";
import { historyMatches } from "../src/ui/battle-history";

const replay: Replay = {
  version: 56,
  seed: 7,
  mode: "classic",
  deck: [...STARTER_DECK],
  enemyDeck: [...PRESETS[1].deck],
  actions: [],
  duration: 30,
};
const record = (overrides: Partial<RecordEntry> = {}): RecordEntry => ({
  id: 1,
  date: "2026-10-28T12:00:00Z",
  winner: "blue",
  crowns: [2, 0],
  mode: "classic",
  replay: { ...replay, mode: overrides.mode ?? replay.mode },
  ...overrides,
});
const history = [
  record({ opponent: "Élodie & King" }),
  record({ opponent: "王小明", winner: "red", mode: "double" }),
  record({ winner: "draw", mode: "training" }),
];
const positions = (query: Parameters<typeof historyMatches>[1]) =>
  historyMatches(history, query).map(({ index }) => index);
const mixedHistory = [
  record(),
  record({ opponent: "Old friend" }),
  record({ matchId: "old-room" }),
  record({ opponentType: "ai", opponent: "Royal Trainer" }),
  record({ opponentType: "friend" }),
  record({ practice: true, opponentType: "ai", opponent: "Practice Captain" }),
  record({
    practice: true,
    mode: "double",
    winner: "red",
    opponent: "Shared deck",
  }),
  record({ opponentType: "ai", mode: "training" }),
  record({ opponentType: "ai", opponent: "Royal Trainer", matchId: "old-tag" }),
];

describe("battle log browsing", () => {
  it.each([
    ["  ELODIE  ", [0]],
    ["ÉloDiE", [0]],
    ["王小", [1]],
    ["Royal Trainer", [2]],
    ["MINI P.E.K.K.A", [0, 1, 2]],
    ["mini-pekka", [0, 1, 2]],
    ["Elodie cannon", [0]],
    ["Élodie missing-card", []],
    [" \t\n ", [0, 1, 2]],
  ])("finds opponent and either deck with %s", (search, expected) => {
    expect(positions({ search })).toEqual(expected);
  });

  it("combines search, result and mode without broadening another filter", () => {
    expect(
      positions({ search: "cannon", result: "red", mode: "double" }),
    ).toEqual([1]);
    expect(
      positions({ search: "cannon", result: "blue", mode: "double" }),
    ).toEqual([]);
    expect(positions({ result: "draw", mode: "training" })).toEqual([2]);
  });

  it("uses the recorded viewer's result for red-side guests", () => {
    const guest = record({
      opponentType: "friend",
      replay: { ...replay, perspective: "red" },
    });
    expect(
      historyMatches([guest], { result: "blue", type: "friend" })[0].record,
    ).toBe(guest);
    expect(historyMatches([guest], { result: "red", type: "friend" })).toEqual(
      [],
    );
    expect(historyMatches([guest], { search: "cannon" })).toHaveLength(1);
  });

  it("preserves source positions and references even when record IDs collide", () => {
    const before = structuredClone(history);
    const selected = historyMatches(history, { result: "draw" });
    expect(selected).toEqual([{ record: history[2], index: 2 }]);
    expect(selected[0].record).toBe(history[2]);
    expect(history).toEqual(before);
    expect(historyMatches(history).map(({ index }) => index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("handles an empty history", () => {
    expect(
      historyMatches([], { search: "giant", result: "red", type: "practice" }),
    ).toEqual([]);
  });

  it.each([
    ["all", [0, 1, 2, 3, 4, 5, 6, 7, 8]],
    ["ai", [0, 3, 7, 8]],
    ["friend", [1, 2, 4]],
    ["practice", [5, 6]],
  ] as const)(
    "selects %s battles across current and older save formats",
    (type, expected) => {
      expect(
        historyMatches(mixedHistory, { type }).map(({ index }) => index),
      ).toEqual(expected);
    },
  );

  it("combines battle type with name/card search, viewer result and pace", () => {
    const query = {
      type: "practice",
      mode: "double",
      result: "red",
      search: "shared cannon",
    } as const;
    expect(
      historyMatches(mixedHistory, query).map(({ index }) => index),
    ).toEqual([6]);
    expect(historyMatches(mixedHistory, { ...query, type: "friend" })).toEqual(
      [],
    );
    expect(historyMatches(mixedHistory, { ...query, result: "blue" })).toEqual(
      [],
    );
    expect(historyMatches(mixedHistory, { ...query, mode: "classic" })).toEqual(
      [],
    );
  });

  it("keeps the original records and positions when filtering duplicate IDs by type", () => {
    const before = structuredClone(mixedHistory);
    const filtered = historyMatches(mixedHistory, { type: "practice" });
    expect(filtered).toEqual([
      { record: mixedHistory[5], index: 5 },
      { record: mixedHistory[6], index: 6 },
    ]);
    expect(filtered[0].record).toBe(mixedHistory[5]);
    expect(filtered[1].record).toBe(mixedHistory[6]);
    expect(mixedHistory).toEqual(before);
  });
});
