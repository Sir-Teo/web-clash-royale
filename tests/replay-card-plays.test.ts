import { expect, it } from "vitest";
import { STARTER_DECK } from "../src/game/cards";
import type { Replay, Team } from "../src/game/engine";
import { replayCardPlays } from "../src/ui/replay-card-plays";

const replay: Replay = {
  version: 56,
  seed: 1,
  mode: "classic",
  deck: STARTER_DECK,
  enemyDeck: STARTER_DECK,
  duration: 90,
  actions: [
    { tick: 0, team: "blue", card: "arrows", x: 4, y: 22 },
    { tick: 0, team: "red", card: "arrows", x: 4, y: 10 },
    { tick: 30, team: "blue", card: "knight", x: 4, y: 22 },
    { tick: 60, team: "red", card: "arrows", x: 4, y: 10 },
    { tick: 90, team: "blue", card: "arrows", x: 4, y: 22 },
  ],
};
it.each([
  [
    "blue",
    "viewed",
    [
      [0, 1],
      [90, 90],
    ],
  ],
  [
    "blue",
    "opponent",
    [
      [0, 1],
      [60, 61],
    ],
  ],
  [
    "red",
    "viewed",
    [
      [0, 1],
      [60, 61],
    ],
  ],
  [
    "red",
    "opponent",
    [
      [0, 1],
      [90, 90],
    ],
  ],
] as const)(
  "%s viewing %s retains the card's own team and endpoint",
  (perspective, side, expected) => {
    const plays = replayCardPlays({ ...replay, perspective }, "arrows", side);
    expect(plays.map((play) => [play.tick, play.targetTick])).toEqual(expected);
    for (const play of plays)
      expect(play.label).toContain(
        `${side === "viewed" ? "Player" : "Opponent"}: Arrows`,
      );
  },
);
it("returns no commands for an unused card", () => {
  expect(replayCardPlays(replay, "fireball")).toEqual([]);
});
it("keeps a zero-duration boundary command available", () => {
  const plays = replayCardPlays(
    { ...replay, duration: 0, actions: replay.actions.slice(0, 2) },
    "arrows",
  );
  expect(plays).toHaveLength(1);
  expect(plays[0]).toMatchObject({ tick: 0, targetTick: 0 });
});
it("does not change frozen replay data or combine a simultaneous opposing play", () => {
  const source = { ...replay, perspective: "red" as Team };
  source.actions.forEach(Object.freeze);
  Object.freeze(source.actions);
  Object.freeze(source);
  const before = JSON.stringify(source);
  const plays = replayCardPlays(source, "arrows", "opponent");
  expect(plays[0].label).toBe("0:00 · Opponent: Arrows");
  expect(JSON.stringify(source)).toBe(before);
});
