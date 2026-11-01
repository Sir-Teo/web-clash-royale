import { expect, it } from "vitest";
import { dailyPractice, dailyPracticeResults } from "../src/ui/daily-practice";
import type { RecordEntry } from "../src/game/profile";

function attempt(
  winner: RecordEntry["winner"],
  day = "2020-02-29",
): RecordEntry {
  const { practice } = dailyPractice(new Date(`${day}T00:00:00Z`));
  return {
    id: 42,
    date: "2026-11-01T00:00:00Z",
    mode: "classic",
    practice: true,
    opponentType: "ai",
    opponent: practice.name,
    winner,
    crowns: [0, 0],
    replay: {
      version: 56,
      mode: "classic",
      seed: practice.openingSeed!,
      deck: practice.playerDeck!,
      enemyDeck: practice.deck,
      actions: [],
      duration: 60,
    },
  };
}
it("counts only the selected daily opening, excluding fresh variations and other dates", () => {
  const variation = attempt("blue");
  variation.replay.seed++;
  const ordinary = attempt("blue");
  delete ordinary.practice;
  const history = [
    attempt("blue"),
    attempt("red"),
    attempt("draw"),
    variation,
    ordinary,
    attempt("blue", "2020-03-01"),
  ];
  expect(dailyPracticeResults(history, "2020-02-29")).toMatchObject({
    wins: 1,
    losses: 1,
    draws: 1,
  });
});
it("returns the newest matching record by timestamp when the log order and IDs cannot identify it", () => {
  const latest = attempt("blue");
  latest.date = "2026-11-01T00:03:00Z";
  const earlier = attempt("red");
  earlier.date = "2026-11-01T00:01:00Z";
  const history = [earlier, latest, attempt("draw")];
  const before = structuredClone(history);
  for (const record of history) Object.freeze(record);
  Object.freeze(history);
  const result = dailyPracticeResults(history, "2020-02-29");
  expect(result.latest).toBe(latest);
  expect(result).toMatchObject({ wins: 1, losses: 1, draws: 1 });
  expect(history).toEqual(before);
});
it("has no latest recording or counts when the selected date is absent", () => {
  expect(dailyPracticeResults([attempt("red")], "2020-03-02")).toEqual({
    wins: 0,
    losses: 0,
    draws: 0,
    latest: undefined,
  });
});
