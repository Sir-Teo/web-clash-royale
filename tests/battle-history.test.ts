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
    const guest = record({ replay: { ...replay, perspective: "red" } });
    expect(historyMatches([guest], { result: "blue" })[0].record).toBe(guest);
    expect(historyMatches([guest], { result: "red" })).toEqual([]);
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
    expect(historyMatches([], { search: "giant", result: "red" })).toEqual([]);
  });
});
