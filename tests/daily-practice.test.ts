import { expect, it } from "vitest";
import { dailyPractice } from "../src/ui/daily-practice";
import { SOLO_OPPONENTS } from "../src/game/opponents";
import { Battle } from "../src/game/engine";

it("retains the same matchup and opening throughout one UTC day", () => {
  const first = dailyPractice(new Date("2026-10-31T00:00:00.000Z"));
  expect(dailyPractice(new Date("2026-10-31T23:59:59.999Z"))).toEqual(first);
  expect(first.day).toBe("2026-10-31");
  expect(first.practice.mode).toBe("classic");
  expect(first.practice.name).toContain(first.day);
});
it("uses the UTC day across local offset boundaries", () => {
  expect(dailyPractice(new Date("2026-11-01T00:15:00+02:00"))).toEqual(
    dailyPractice(new Date("2026-10-31T22:15:00Z")),
  );
});
it("changes the opening at the UTC midnight boundary", () => {
  const before = dailyPractice(new Date("2026-10-31T23:59:59.999Z"));
  const after = dailyPractice(new Date("2026-11-01T00:00:00.000Z"));
  expect(after.day).toBe("2026-11-01");
  expect(after.practice.openingSeed).not.toBe(before.practice.openingSeed);
});
it("selects distinct legal archetypes and reaches every curated deck over a year", () => {
  const players = new Set<string>();
  const opponents = new Set<number>();
  for (let offset = 0; offset < 400; offset++) {
    const { practice } = dailyPractice(new Date(Date.UTC(2026, 0, 1 + offset)));
    const selection = practice.selection!;
    players.add(selection.playerChoice);
    opponents.add(selection.opponentIndex);
    expect(selection.playerChoice).not.toBe(
      `curated:${selection.opponentIndex}`,
    );
    expect(practice.playerDeck).toHaveLength(8);
    expect(practice.deck).toHaveLength(8);
    expect(practice.openingSeed).toBeGreaterThan(0);
    expect(practice.openingSeed).toBeLessThanOrEqual(2147483647);
    expect(practice.name.length).toBeLessThanOrEqual(64);
  }
  expect(players.size).toBe(SOLO_OPPONENTS.length);
  expect(opponents.size).toBe(SOLO_OPPONENTS.length);
});
it("copies both decks without changing the curated roster", () => {
  const original = structuredClone(SOLO_OPPONENTS);
  const date = new Date("2026-10-31T12:00:00Z");
  const challenge = dailyPractice(date);
  challenge.practice.deck.reverse();
  challenge.practice.playerDeck!.reverse();
  expect(SOLO_OPPONENTS).toEqual(original);
  expect(dailyPractice(date).practice.deck).not.toBe(challenge.practice.deck);
});
it("feeds reproducible hands and AI opening commands into the existing simulation", () => {
  const { practice } = dailyPractice(new Date("2026-10-31T12:00:00Z"));
  const options = {
    mode: practice.mode,
    deck: practice.playerDeck,
    enemyDeck: practice.deck,
    seed: practice.openingSeed,
  };
  const first = new Battle(options);
  const second = new Battle(options);
  expect(first.players).toEqual(second.players);
  for (let tick = 0; tick < 300; tick++) {
    first.step();
    second.step();
  }
  expect(first.exportReplay()).toEqual(second.exportReplay());
  expect(first.entities).toEqual(second.entities);
});
