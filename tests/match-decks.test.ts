import { beforeEach, describe, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import { loadProfile, saveProfile } from "../src/game/profile";
import type { RecordEntry } from "../src/game/profile";
import {
  recordedDecks,
  restoreDeckSelection,
  useRecordedDeck,
} from "../src/game/match-decks";

const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});
function record(red = false): RecordEntry {
  const battle = new Battle({ seed: 8, ai: false, enemyDeck: PRESETS[1].deck });
  battle.finish("red", "Surrender");
  return {
    id: 1,
    date: "2026-10-24T12:00:00.000Z",
    winner: red ? "blue" : "red",
    crowns: red ? [1, 0] : [0, 1],
    mode: "classic",
    replay: {
      ...battle.exportReplay(),
      ...(red ? { perspective: "red" as const } : {}),
    },
  };
}

describe("recorded match decks", () => {
  it("uses the viewer's actual deck for canonical and red-side friend records", () => {
    expect(recordedDecks(record())).toEqual({
      yours: STARTER_DECK,
      opponent: PRESETS[1].deck,
    });
    expect(recordedDecks(record(true))).toEqual({
      yours: PRESETS[1].deck,
      opponent: STARTER_DECK,
    });
    for (const version of [1, 2, 3, 4, 5] as const) {
      const entry = record();
      entry.replay.version = version;
      expect(recordedDecks(entry).yours).toEqual(STARTER_DECK);
    }
  });

  it("selects a destination slot and preserves the other decks, rewards and replay", () => {
    const profile = loadProfile(),
      entry = record();
    profile.history = [entry];
    const before = structuredClone(profile);
    useRecordedDeck(profile, entry, "opponent", 1);
    expect(profile.activeDeck).toBe(1);
    expect(profile.deck).toEqual(PRESETS[1].deck);
    expect(profile.decks[1]).toEqual(PRESETS[1].deck);
    expect(profile.decks[0]).toEqual(before.decks[0]);
    expect(profile.decks[2]).toEqual(before.decks[2]);
    expect(profile.history).toEqual(before.history);
    expect(profile.gold).toBe(before.gold);
    expect(profile.trophies).toBe(before.trophies);
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });

  it("copies the chosen side without aliasing either the record or the active deck slot", () => {
    const profile = loadProfile(),
      entry = record(true),
      original = structuredClone(entry);
    const preview = recordedDecks(entry);
    preview.opponent[0] = "rage";
    expect(entry).toEqual(original);
    useRecordedDeck(profile, entry, "yours", 2);
    profile.deck[0] = "rage";
    expect(profile.decks[2]).toEqual(PRESETS[1].deck);
    expect(entry).toEqual(original);
  });

  it("restores the complete previous deck selection after switching slots and survives reload", () => {
    const profile = loadProfile();
    profile.activeDeck = 2;
    profile.deck = [...profile.decks[2]];
    const before = structuredClone(profile),
      previous = useRecordedDeck(profile, record(), "opponent", 0);
    restoreDeckSelection(profile, previous);
    expect(profile).toEqual(before);
    saveProfile(profile);
    expect(loadProfile()).toEqual(before);
    previous.deck[0] = "rage";
    previous.decks[2][0] = "rage";
    expect(profile).toEqual(before);
  });

  it("rejects invalid destinations and corrupt source cards before touching any saved deck", () => {
    const profile = loadProfile(),
      before = structuredClone(profile);
    for (const slot of [-1, 3, 0.5, NaN])
      expect(() => useRecordedDeck(profile, record(), "yours", slot)).toThrow();
    const entry = record();
    entry.replay.enemyDeck[0] = "constructor" as never;
    expect(() => useRecordedDeck(profile, entry, "opponent", 0)).toThrow();
    entry.replay.enemyDeck = Array(8).fill("knight");
    expect(() => useRecordedDeck(profile, entry, "opponent", 0)).toThrow();
    expect(profile).toEqual(before);
  });

  it("rejects a corrupted undo snapshot without replacing the selected deck", () => {
    const profile = loadProfile(),
      previous = useRecordedDeck(profile, record(), "opponent", 1),
      before = structuredClone(profile);
    previous.activeDeck = 3;
    expect(() => restoreDeckSelection(profile, previous)).toThrow();
    expect(profile).toEqual(before);
  });
});
