import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeckEditHistory,
  copyDeckSelection,
} from "../src/ui/deck-edit-history";
import { loadProfile } from "../src/game/profile";
import { restoreDeckSelection, useDeck } from "../src/game/match-decks";
import type { Profile } from "../src/game/profile";
import type { CardId } from "../src/game/cards";
beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

function scene(limit = 50) {
  const profile = loadProfile(),
    history = new DeckEditHistory(limit);
  history.reset(profile);
  return { profile, history };
}
function edit(
  history: DeckEditHistory,
  profile: Profile,
  deck: CardId[],
  label = "Edit",
) {
  const before = copyDeckSelection(profile);
  useDeck(profile, deck, profile.activeDeck);
  return history.record(before, profile, {
    label,
    beforeFocus: 0,
    afterFocus: 1,
  });
}
function undo(history: DeckEditHistory, profile: Profile) {
  const change = history.undo(profile);
  if (change) restoreDeckSelection(profile, change.selection);
  return change;
}
function redo(history: DeckEditHistory, profile: Profile) {
  const change = history.redo(profile);
  if (change) restoreDeckSelection(profile, change.selection);
  return change;
}

describe("deck builder edit history", () => {
  it("restores a sequence of reordered/replaced decks in both directions", () => {
    const { profile: p, history: h } = scene(),
      original = structuredClone(p);
    edit(h, p, [...p.deck].reverse(), "Reorder");
    const moved = structuredClone(p);
    edit(h, p, ["freeze", ...p.deck.slice(1)], "Replace");
    const replaced = structuredClone(p);
    expect(undo(h, p)).toMatchObject({ label: "Replace", focusSlot: 0 });
    expect(p).toEqual(moved);
    expect(undo(h, p)?.label).toBe("Reorder");
    expect(p).toEqual(original);
    expect(h.undoLabel).toBeUndefined();
    expect(redo(h, p)).toMatchObject({ label: "Reorder", focusSlot: 1 });
    expect(p).toEqual(moved);
    expect(redo(h, p)?.label).toBe("Replace");
    expect(p).toEqual(replaced);
    expect(h.redoLabel).toBeUndefined();
  });
  it("owns its snapshots and never exposes mutable history arrays", () => {
    const { profile: p, history: h } = scene();
    const before = copyDeckSelection(p);
    const after = copyDeckSelection(p);
    after.deck.reverse();
    after.decks[0] = [...after.deck];
    const expectedBefore = structuredClone(before),
      expectedAfter = structuredClone(after);
    const details = {
      label: "Reorder",
      beforeFocus: 0,
      afterFocus: 7,
      before,
      after,
    };
    h.record(before, after, details);
    before.deck.reverse();
    before.decks[1].reverse();
    after.deck.reverse();
    after.decks[2].reverse();
    const change = h.undo(expectedAfter)!;
    expect(change.selection).toEqual(expectedBefore);
    change.selection.deck.reverse();
    change.selection.decks[0].reverse();
    const next = h.redo(expectedBefore)!;
    expect(next.selection).toEqual(expectedAfter);
    next.selection.deck.reverse();
    expect(h.undo(expectedAfter)!.selection).toEqual(expectedBefore);
  });
  it.each(["active", "inactive", "selection"])(
    "clears history rather than overwriting an external %s change",
    (kind) => {
      const { profile: p, history: h } = scene();
      edit(h, p, [...p.deck].reverse());
      if (kind === "active")
        useDeck(p, ["freeze", ...p.deck.slice(1)], p.activeDeck);
      if (kind === "inactive") p.decks[2].reverse();
      if (kind === "selection") useDeck(p, p.decks[1], 1);
      const foreign = structuredClone(p);
      expect(undo(h, p)).toBeUndefined();
      expect(p).toEqual(foreign);
      expect(h.undoLabel).toBeUndefined();
      expect(h.redoLabel).toBeUndefined();
    },
  );
  it("does not roll back progress or preferences changed after an edit", () => {
    const { profile: p, history: h } = scene();
    const original = copyDeckSelection(p);
    edit(h, p, [...p.deck].reverse());
    p.gold += 750;
    p.trophies += 30;
    p.sound = !p.sound;
    p.name = "New name";
    const latest = structuredClone(p);
    undo(h, p);
    expect(p).toEqual({ ...latest, ...original });
  });
  it("retains edits after a temporary external adoption is fully undone", () => {
    const { profile: p, history: h } = scene();
    edit(h, p, [...p.deck].reverse(), "Original edit");
    const beforeCode = useDeck(p, p.decks[2], 2);
    restoreDeckSelection(p, beforeCode);
    expect(h.sync(p)).toBe(false);
    expect(undo(h, p)?.label).toBe("Original edit");
  });
  it("keeps redo after a no-op but discards it after a new branch", () => {
    const { profile: p, history: h } = scene();
    edit(h, p, [...p.deck].reverse(), "Old branch");
    undo(h, p);
    expect(edit(h, p, [...p.deck], "No change")).toBe(false);
    expect(h.redoLabel).toBe("Old branch");
    edit(h, p, ["zap", ...p.deck.slice(1)], "New branch");
    expect(h.redoLabel).toBeUndefined();
    expect(redo(h, p)).toBeUndefined();
    expect(h.undoLabel).toBe("New branch");
  });
  it("bounds retained history while preserving the remaining undo/redo sequence", () => {
    const { profile: p, history: h } = scene(2);
    edit(h, p, [...p.deck].reverse(), "First");
    const first = copyDeckSelection(p);
    edit(h, p, ["freeze", ...p.deck.slice(1)], "Second");
    edit(h, p, ["zap", ...p.deck.slice(1)], "Third");
    const final = copyDeckSelection(p);
    expect(undo(h, p)?.label).toBe("Third");
    expect(undo(h, p)?.label).toBe("Second");
    expect(copyDeckSelection(p)).toEqual(first);
    expect(undo(h, p)).toBeUndefined();
    redo(h, p);
    redo(h, p);
    expect(copyDeckSelection(p)).toEqual(final);
  });
  it("clears both directions for a fresh builder visit", () => {
    const { profile: p, history: h } = scene();
    edit(h, p, [...p.deck].reverse());
    undo(h, p);
    h.reset(p);
    expect(h.undoLabel).toBeUndefined();
    expect(h.redoLabel).toBeUndefined();
    expect(undo(h, p)).toBeUndefined();
    expect(redo(h, p)).toBeUndefined();
  });
});
