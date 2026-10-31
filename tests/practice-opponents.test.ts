import { expect, it } from "vitest";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import {
  practiceDeckChoices,
  practiceOpponents,
  practiceRoster,
} from "../src/ui/practice-opponents";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import { validDeck } from "../src/game/profile";

it("retains every opponent's identity and order without a search", () => {
  for (const query of ["", "  ", " · "])
    expect(practiceOpponents(query)).toEqual(
      SOLO_OPPONENTS.map((opponent, index) => ({ opponent, index })),
    );
});

it("keeps saved player slot values and adds a distinct choice for every curated deck", () => {
  const choices = practiceDeckChoices([
    STARTER_DECK,
    PRESETS[1].deck,
    PRESETS[2].deck,
  ]);
  expect(choices.slice(0, 3).map((choice) => choice.value)).toEqual([
    "0",
    "1",
    "2",
  ]);
  expect(choices).toHaveLength(3 + SOLO_OPPONENTS.length);
  expect(new Set(choices.map((choice) => choice.value)).size).toBe(
    choices.length,
  );
  expect(choices.every((choice) => validDeck(choice.deck))).toBe(true);
});

it("resolves curated player choices to the exact archived card order", () => {
  const choices = practiceDeckChoices([STARTER_DECK]);
  for (const [index, opponent] of SOLO_OPPONENTS.entries()) {
    const choice = choices.find(
      (choice) => choice.value === `curated:${index}`,
    )!;
    expect(choice.name).toBe(opponent.style);
    expect(choice.deck).toEqual(opponent.deck);
    expect(choice.deck).not.toBe(opponent.deck);
    expect(choice.savedSlot).toBeUndefined();
  }
});

it("isolates player loadout snapshots from later saved-slot edits", () => {
  const deck = [...STARTER_DECK];
  const choices = practiceDeckChoices([deck, deck]);
  deck.reverse();
  expect(choices[0].deck).toEqual(STARTER_DECK);
  expect(choices[1].deck).toEqual(STARTER_DECK);
  expect(choices[0].deck).not.toBe(choices[1].deck);
});

it("keeps curated opponents unchanged when a player loadout is reordered", () => {
  const original = [...SOLO_OPPONENTS[7].deck];
  const choices = practiceDeckChoices();
  (choices[7].deck as string[]).reverse();
  expect(SOLO_OPPONENTS[7].deck).toEqual(original);
});

it("appends saved decks without changing curated opponent identities or indexes", () => {
  const decks = [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck];
  const roster = practiceRoster(decks);
  expect(practiceRoster()).toEqual(SOLO_OPPONENTS);
  expect(roster).toHaveLength(SOLO_OPPONENTS.length + 3);
  SOLO_OPPONENTS.forEach((opponent, index) =>
    expect(roster[index]).toBe(opponent),
  );
  decks.forEach((deck, slot) => {
    expect(roster[SOLO_OPPONENTS.length + slot]).toEqual({
      name: `Battle deck ${slot + 1}`,
      style: "Your saved deck",
      deck,
      savedSlot: slot,
    });
  });
});

it("takes independent snapshots of saved card order for each practice visit", () => {
  const deck = [...STARTER_DECK];
  const roster = practiceRoster([deck, deck]);
  deck.reverse();
  for (const opponent of roster.slice(SOLO_OPPONENTS.length)) {
    expect(opponent.deck).toEqual(STARTER_DECK);
    expect(opponent.deck).not.toBe(deck);
  }
  expect(roster.at(-1)!.deck).not.toBe(roster.at(-2)!.deck);
  expect(practiceRoster([deck]).at(-1)!.deck).toEqual(deck);
});

it("finds saved opponents by category and slot while retaining their source indexes", () => {
  const roster = practiceRoster([
    STARTER_DECK,
    PRESETS[1].deck,
    PRESETS[2].deck,
  ]);
  expect(
    practiceOpponents("saved", roster).map((entry) => entry.index),
  ).toEqual([17, 18, 19]);
  expect(
    practiceOpponents("battle deck 2", roster).map((entry) => entry.index),
  ).toEqual([18]);
});

it("finds a card across curated and saved opponents without merging their identities", () => {
  const deck = [...STARTER_DECK];
  deck[0] = "sparky";
  const roster = practiceRoster([deck]);
  const matches = practiceOpponents("sparky", roster);
  expect(matches.map((entry) => entry.index)).toEqual([16, 17]);
  expect(matches[0].opponent).toBe(SOLO_OPPONENTS[16]);
  expect(matches[1].opponent).toBe(roster[17]);
});

it.each([
  ["Spark Commander", [16]],
  ["HUT REINFORCEMENTS", [14]],
  ["sparky", [16]],
  ["P.E.K.K.A", [0, 4, 5]],
  ["pekka", [0, 4, 5]],
  ["X-bow", [9]],
  ["  SÍEGE    X-BOW  ", [9]],
  ["golem night witch", [8]],
  ["sparky zap", [16]],
  ["sparky graveyard", []],
  ["not a real card", []],
  ["法师", []],
])("finds names, styles and starting cards for %s", (query, indexes) => {
  const matches = practiceOpponents(query as string);
  expect(matches.map(({ index }) => index)).toEqual(indexes);
  for (const { opponent, index } of matches)
    expect(opponent).toBe(SOLO_OPPONENTS[index]);
});
