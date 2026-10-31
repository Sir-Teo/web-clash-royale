import { expect, it } from "vitest";
import { PRESETS, STARTER_DECK, type CardId } from "../src/game/cards";
import type { RecordEntry } from "../src/game/profile";
import type { Mode } from "../src/game/engine";
import { practiceResults } from "../src/ui/practice-results";

const own = STARTER_DECK;
const enemy = PRESETS[2].deck;
function record(
  winner: RecordEntry["winner"],
  options: {
    red?: boolean;
    practice?: boolean;
    mode?: Mode;
    player?: readonly CardId[];
    opponent?: readonly CardId[];
  } = {},
): RecordEntry {
  const player = [...(options.player ?? own)];
  const opponent = [...(options.opponent ?? enemy)];
  const mode = options.mode ?? "classic";
  return {
    id: 1,
    date: "2026-10-31T12:00:00.000Z",
    opponent: "Any deck name",
    opponentType: "ai",
    ...(options.practice === false ? {} : { practice: true }),
    winner,
    mode,
    crowns: [0, 0],
    replay: {
      version: 56,
      rulesFamily: "origin",
      seed: 1,
      mode,
      duration: 0,
      actions: [],
      deck: options.red ? opponent : player,
      enemyDeck: options.red ? player : opponent,
      ...(options.red ? { perspective: "red" } : {}),
    },
  };
}

it("returns an empty saved record without manufacturing matches", () => {
  expect(practiceResults([], own, enemy, "classic")).toEqual({
    wins: 0,
    losses: 0,
    draws: 0,
  });
});
it("counts the viewer's wins, losses and draws separately", () => {
  expect(
    practiceResults(
      [record("blue"), record("red"), record("draw"), record("blue")],
      own,
      enemy,
      "classic",
    ),
  ).toEqual({ wins: 2, losses: 1, draws: 1 });
});
it.each(["blue", "red", "draw"] as const)(
  "reads a red recording's decks without flipping its %s result again",
  (winner) => {
    const expected = {
      wins: winner === "blue" ? 1 : 0,
      losses: winner === "red" ? 1 : 0,
      draws: winner === "draw" ? 1 : 0,
    };
    expect(
      practiceResults([record(winner, { red: true })], own, enemy, "classic"),
    ).toEqual(expected);
  },
);
it("treats different saved card orders as the same deck composition", () => {
  expect(
    practiceResults(
      [
        record("blue", {
          player: [...own].reverse(),
          opponent: [...enemy].reverse(),
        }),
      ],
      own,
      enemy,
      "classic",
    ),
  ).toEqual({ wins: 1, losses: 0, draws: 0 });
});
it("keeps different cards and exchanged player/opponent decks separate", () => {
  expect(
    practiceResults(
      [
        record("blue", { player: PRESETS[1].deck }),
        record("blue", { opponent: PRESETS[1].deck }),
        record("blue", { player: enemy, opponent: own }),
      ],
      own,
      enemy,
      "classic",
    ),
  ).toEqual({ wins: 0, losses: 0, draws: 0 });
});
it("keeps Training, Classic and Double elixir results separate", () => {
  const history = [
    record("blue", { mode: "training" }),
    record("red"),
    record("draw", { mode: "double" }),
  ];
  expect(practiceResults(history, own, enemy, "training")).toEqual({
    wins: 1,
    losses: 0,
    draws: 0,
  });
  expect(practiceResults(history, own, enemy, "classic")).toEqual({
    wins: 0,
    losses: 1,
    draws: 0,
  });
  expect(practiceResults(history, own, enemy, "double")).toEqual({
    wins: 0,
    losses: 0,
    draws: 1,
  });
});
it("excludes ordinary AI, friendly and unlabelled Training battles", () => {
  const ordinary = record("blue", { practice: false });
  const friend = { ...ordinary, opponentType: "friend" as const };
  expect(practiceResults([ordinary, friend], own, enemy, "classic")).toEqual({
    wins: 0,
    losses: 0,
    draws: 0,
  });
  expect(
    practiceResults(
      [record("blue", { mode: "training", practice: false })],
      own,
      enemy,
      "training",
    ),
  ).toEqual({ wins: 0, losses: 0, draws: 0 });
});
it("uses captured cards instead of mutable saved-slot or opponent names", () => {
  expect(
    practiceResults(
      [
        { ...record("blue"), opponent: "Battle deck 3" },
        { ...record("red"), opponent: "Renamed opponent" },
      ],
      own,
      enemy,
      "classic",
    ),
  ).toEqual({ wins: 1, losses: 1, draws: 0 });
});
it("does not mutate saved recordings or selected card order", () => {
  const history = [record("blue", { red: true })];
  const before = JSON.stringify({ history, own, enemy });
  Object.freeze(history[0].replay.deck);
  Object.freeze(history[0].replay.enemyDeck);
  Object.freeze(history[0].replay);
  Object.freeze(history[0]);
  Object.freeze(history);
  practiceResults(history, own, enemy, "classic");
  expect(JSON.stringify({ history, own, enemy })).toBe(before);
});
