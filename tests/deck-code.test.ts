import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARDS, STARTER_DECK, PRESETS, type CardId } from "../src/game/cards";
import {
  decodeDeckCode,
  encodeDeckCode,
  DECK_CODE_PREFIX,
  MAX_DECK_CODE_BYTES,
} from "../src/game/deck-code";
import { loadProfile, saveProfile } from "../src/game/profile";
import { useDeck, restoreDeckSelection } from "../src/game/match-decks";
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
  });
});

describe("portable deck codes", () => {
  it("round-trips exact order and every card using stable card IDs", () => {
    for (const card of CARDS) {
      const deck = [
        card.id,
        ...CARDS.filter((c) => c.id !== card.id)
          .slice(0, 7)
          .map((c) => c.id),
      ];
      const code = encodeDeckCode(deck);
      expect(code.startsWith(DECK_CODE_PREFIX)).toBe(true);
      expect(decodeDeckCode(code)).toEqual(deck);
      expect(code).toContain(card.id);
    }
    expect(encodeDeckCode(STARTER_DECK)).toBe(
      DECK_CODE_PREFIX + STARTER_DECK.join(","),
    );
  });
  it("accepts pasted whitespace between card IDs without changing their order", () => {
    const code = ` \n${DECK_CODE_PREFIX}${STARTER_DECK.join(",\n ")} \n`;
    expect(decodeDeckCode(code)).toEqual(STARTER_DECK);
    const deck = decodeDeckCode(encodeDeckCode(STARTER_DECK));
    deck[0] = "rocket";
    expect(STARTER_DECK[0]).toBe("knight");
  });
  it("rejects unrelated, future, oversized, duplicate and unsupported codes", () => {
    for (const code of [
      "",
      "CR1.invite",
      "BRA-DECK-2:" + STARTER_DECK.join(","),
      "{}",
      "x".repeat(MAX_DECK_CODE_BYTES + 1),
      DECK_CODE_PREFIX + STARTER_DECK.slice(1).join(","),
      DECK_CODE_PREFIX + Array(8).fill("knight").join(","),
      DECK_CODE_PREFIX + ["toString", ...STARTER_DECK.slice(1)].join(","),
      DECK_CODE_PREFIX + ["<script>", ...STARTER_DECK.slice(1)].join(","),
    ])
      expect(() => decodeDeckCode(code)).toThrow();
    expect(() => encodeDeckCode(["knight"])).toThrow();
  });
  it("does not write progress while copying or previewing", () => {
    const profile = loadProfile(),
      before = structuredClone(profile);
    decodeDeckCode(encodeDeckCode(profile.deck));
    expect(profile).toEqual(before);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it("adopts into a selected slot, preserves all other progress and reloads", () => {
    const profile = loadProfile();
    profile.gold = 2345;
    profile.trophies = 123;
    profile.chests = ["gold"];
    const before = structuredClone(profile),
      deck = decodeDeckCode(encodeDeckCode(PRESETS[1].deck));
    useDeck(profile, deck, 2);
    expect(profile.activeDeck).toBe(2);
    expect(profile.deck).toEqual(deck);
    expect(profile.decks[2]).toEqual(deck);
    expect(profile.decks[0]).toEqual(before.decks[0]);
    expect(profile.decks[1]).toEqual(before.decks[1]);
    expect(profile.gold).toBe(before.gold);
    expect(profile.trophies).toBe(before.trophies);
    expect(profile.chests).toEqual(before.chests);
    expect(profile.history).toEqual(before.history);
    deck[0] = "rocket";
    expect(profile.deck).toEqual(PRESETS[1].deck);
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });
  it("restores the full previous selection with independent Undo arrays", () => {
    const profile = loadProfile();
    profile.deck[0] = "rocket";
    const before = structuredClone(profile),
      undo = useDeck(profile, PRESETS[1].deck, 1);
    restoreDeckSelection(profile, undo);
    expect(profile).toEqual(before);
    undo.deck[0] = "rage";
    undo.decks[0][0] = "rage";
    expect(profile).toEqual(before);
  });
  it("rejects bad cards or a bad destination before mutation", () => {
    const profile = loadProfile(),
      before = structuredClone(profile);
    for (const slot of [-1, 3, 0.5, NaN])
      expect(() => useDeck(profile, STARTER_DECK, slot)).toThrow();
    expect(() => useDeck(profile, Array(8).fill("knight"), 0)).toThrow();
    expect(() =>
      useDeck(
        profile,
        ["constructor", ...STARTER_DECK.slice(1)] as CardId[],
        0,
      ),
    ).toThrow();
    expect(profile).toEqual(before);
  });
});
