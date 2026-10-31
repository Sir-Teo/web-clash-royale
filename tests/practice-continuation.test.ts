import { expect, it } from "vitest";
import { PRESETS, STARTER_DECK } from "../src/game/cards";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import type { PracticeOpponent } from "../src/game/match-decks";
import {
  continuedPracticeChoices,
  practiceDeckChoices,
  practiceOpponents,
  practiceRoster,
  swapPracticeDecks,
} from "../src/ui/practice-opponents";

const decks = [STARTER_DECK, PRESETS[1].deck, PRESETS[2].deck];
const practice = (): PracticeOpponent => ({
  name: "Outside Rival",
  style: "Recorded deck",
  mode: "double",
  deck: [
    "rocket",
    "rage",
    "hog-rider",
    "musketeer",
    "cannon",
    "skeletons",
    "goblins",
    "zap",
  ],
});

it("keeps an unlisted recorded opponent as a temporary choice instead of replacing its cards", () => {
  const source = practice();
  expect(
    practiceRoster(decks).some((choice) =>
      choice.deck.every((id, index) => id === source.deck[index]),
    ),
  ).toBe(false);
  const result = continuedPracticeChoices(source, decks, 2);
  expect(result).toEqual({
    playerChoice: "2",
    opponentIndex: 20,
    previousDeck: {
      name: source.name,
      style: source.style,
      deck: source.deck,
    },
  });
  expect(result.previousDeck!.deck).not.toBe(source.deck);
  source.deck.reverse();
  expect(result.previousDeck!.deck).not.toEqual(source.deck);
});

it("reuses an exact curated or saved starting order without adding another choice", () => {
  const roster = practiceRoster(decks);
  for (const choice of roster) {
    const result = continuedPracticeChoices(
      { ...practice(), deck: [...choice.deck] },
      decks,
      1,
    );
    expect(result.playerChoice).toBe("1");
    expect(result.previousDeck).toBeUndefined();
    expect(roster[result.opponentIndex].deck).toEqual(choice.deck);
  }
});

it("retains selected saved identities when another slot has identical cards", () => {
  const duplicates = [STARTER_DECK, STARTER_DECK, STARTER_DECK];
  const result = continuedPracticeChoices(
    {
      ...practice(),
      deck: [...STARTER_DECK],
      selection: { playerChoice: "1", opponentIndex: 19 },
    },
    duplicates,
    0,
  );
  expect(result).toEqual({
    playerChoice: "1",
    opponentIndex: 19,
    previousDeck: undefined,
  });
});

it("retains a temporary player source after swapping to a regular saved opponent", () => {
  const previousDeck = practice();
  const source: PracticeOpponent = {
    ...practice(),
    deck: [...decks[2]],
    playerDeck: [...previousDeck.deck],
    selection: { playerChoice: "previous", opponentIndex: 19, previousDeck },
  };
  const before = structuredClone(source);
  const result = continuedPracticeChoices(source, decks, 2);
  expect(result).toEqual({
    playerChoice: "previous",
    opponentIndex: 19,
    previousDeck: {
      name: previousDeck.name,
      style: previousDeck.style,
      deck: previousDeck.deck,
    },
  });
  expect(result.previousDeck!.deck).not.toBe(previousDeck.deck);
  expect(source).toEqual(before);
});

it("appends the temporary choice to both sides without moving any regular identities", () => {
  const source = practice();
  const roster = practiceRoster(decks, source);
  const choices = practiceDeckChoices(decks, source);
  expect(roster.slice(0, 20)).toEqual(practiceRoster(decks));
  expect(choices.slice(0, 20)).toEqual(practiceDeckChoices(decks));
  expect(roster).toHaveLength(21);
  expect(choices).toHaveLength(21);
  expect(choices[20]).toMatchObject({
    value: "previous",
    name: source.name,
    opponentIndex: 20,
    previous: true,
    deck: source.deck,
  });
  expect(swapPracticeDecks(choices, "curated:7", 20)).toEqual({
    playerChoice: "previous",
    opponentIndex: 7,
  });
  expect(swapPracticeDecks(choices, "previous", 7)).toEqual({
    playerChoice: "curated:7",
    opponentIndex: 20,
  });
  source.deck.reverse();
  expect(roster[20].deck).not.toEqual(source.deck);
  expect(choices[20].deck).not.toEqual(source.deck);
  expect(roster[20].deck).not.toBe(choices[20].deck);
});

it("finds the temporary opponent by name, category and card while retaining its source index", () => {
  const roster = practiceRoster(decks, practice());
  for (const query of ["outside rival", "previous practice", "recorded rocket"])
    expect(
      practiceOpponents(query, roster).map((entry) => entry.index),
    ).toEqual([20]);
});

it("keeps a distinct temporary identity even when its cards duplicate a regular deck", () => {
  const source = { ...practice(), deck: [...SOLO_OPPONENTS[7].deck] };
  const choices = practiceDeckChoices(decks, source);
  const result = continuedPracticeChoices(
    {
      ...source,
      selection: {
        playerChoice: "curated:7",
        opponentIndex: 20,
        previousDeck: source,
      },
    },
    decks,
    2,
  );
  expect(result.opponentIndex).toBe(20);
  expect(result.previousDeck!.deck).toEqual(SOLO_OPPONENTS[7].deck);
  expect(
    swapPracticeDecks(choices, result.playerChoice, result.opponentIndex),
  ).toEqual({ playerChoice: "previous", opponentIndex: 7 });
});

it.each(["Shared deck", "Recorded deck", "Shared replay"] as const)(
  "keeps a %s trial distinguishable and searchable on either side",
  (category) => {
    const source = { ...practice(), category };
    const roster = practiceRoster(decks, source);
    const choices = practiceDeckChoices(decks, source);
    expect(roster[20].category).toBe(category);
    expect(choices[20].category).toBe(category);
    expect(
      practiceOpponents(category, roster).map((entry) => entry.index),
    ).toEqual([20]);
    expect(swapPracticeDecks(choices, "previous", 19)).toEqual({
      playerChoice: "2",
      opponentIndex: 20,
    });
  },
);

it.each(["Shared deck", "Recorded deck", "Shared replay"] as const)(
  "retains a %s trial category when a completed practice reopens its setup",
  (category) => {
    const previousDeck = { ...practice(), category };
    const source = {
      ...practice(),
      deck: [...decks[2]],
      playerDeck: [...previousDeck.deck],
      selection: { playerChoice: "previous", opponentIndex: 19, previousDeck },
    };
    const result = continuedPracticeChoices(source, decks, 2);
    expect(result.previousDeck).toEqual({
      name: previousDeck.name,
      style: previousDeck.style,
      category,
      deck: previousDeck.deck,
    });
    expect(result.previousDeck!.deck).not.toBe(previousDeck.deck);
    expect(result.playerChoice).toBe("previous");
    expect(result.opponentIndex).toBe(19);
  },
);
