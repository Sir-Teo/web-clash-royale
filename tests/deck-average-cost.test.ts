import { expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { STARTER_DECK, type CardId } from "../src/game/cards";
import { deckAverageCostLabel } from "../src/ui/deck-average-cost";

it("retains a single ordinary deck average", () => {
  expect(deckAverageCostLabel(STARTER_DECK)).toBe("3.5");
});
it("matches the complete actual Mirror price range without changing a read-only deck", () => {
  const deck: readonly CardId[] = Object.freeze([
    "mirror",
    "skeletons",
    "knight",
    "archers",
    "goblins",
    "musketeer",
    "giant",
    "three-musketeers",
  ] as CardId[]);
  const before = [...deck];
  const battle = new Battle({ deck: [...deck], seed: 1, ai: false });
  const fixed = deck.filter((id) => id !== "mirror");
  const total = fixed.reduce(
    (sum, id) => sum + battle.cardCost("blue", id)!,
    0,
  );
  const prices = fixed.map((id) => {
    battle.players.blue.lastPlayed = id;
    return battle.cardCost("blue", "mirror")!;
  });
  expect(prices).toContain(2);
  expect(prices).toContain(10);
  const low = ((total + Math.min(...prices)) / deck.length).toFixed(1);
  const high = ((total + Math.max(...prices)) / deck.length).toFixed(1);
  expect(deckAverageCostLabel(deck)).toBe(`${low}–${high}`);
  expect(deckAverageCostLabel(deck)).toBe("3.6–4.6");
  expect(deck).toEqual(before);
});
it("uses a single accurate average when every eligible Mirror target costs the same", () => {
  expect(
    deckAverageCostLabel([
      "mirror",
      "knight",
      "archers",
      "arrows",
      "skeleton-army",
      "guards",
      "mega-minion",
      "dart-goblin",
    ]),
  ).toBe("3.1");
});
