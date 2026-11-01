import { expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { dailyPractice, recordedDailyDate } from "../src/ui/daily-practice";
import type { RecordEntry } from "../src/game/profile";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";

function dailyRecord(day = "2020-02-29"): RecordEntry {
  const { practice } = dailyPractice(new Date(`${day}T12:00:00Z`));
  return {
    id: 1,
    date: "2026-11-01T00:00:00Z",
    mode: "classic",
    practice: true,
    opponent: practice.name,
    opponentType: "ai",
    winner: "red",
    crowns: [0, 0],
    replay: new Battle({
      mode: "classic",
      seed: practice.openingSeed,
      deck: practice.playerDeck,
      enemyDeck: practice.deck,
    }).exportReplay(),
  };
}
it.each(["0001-01-01", "2020-02-29", "9999-12-31"])(
  "recognizes %s independently of the recording date without mutating it",
  (day) => {
    const record = dailyRecord(day);
    const before = structuredClone(record);
    expect(recordedDailyDate(record)).toBe(day);
    expect(record).toEqual(before);
  },
);
it("recognizes a portable daily recording after export and import", () => {
  const shared = importReplayFile(
    exportReplayFile(dailyRecord(), "Daily Student"),
  );
  expect(recordedDailyDate(shared.record)).toBe("2020-02-29");
});
it.each([
  [
    "ordinary battle",
    (r: RecordEntry) => {
      delete r.practice;
    },
  ],
  [
    "friendly battle",
    (r: RecordEntry) => {
      r.opponentType = "friend";
    },
  ],
  [
    "different recorded pace",
    (r: RecordEntry) => {
      r.mode = "double";
    },
  ],
  [
    "different simulation pace",
    (r: RecordEntry) => {
      r.replay.mode = "training";
    },
  ],
  [
    "historical rules",
    (r: RecordEntry) => {
      r.replay.version = 55;
    },
  ],
  [
    "local rules family",
    (r: RecordEntry) => {
      r.replay.rulesFamily = "local";
    },
  ],
  [
    "opponent perspective",
    (r: RecordEntry) => {
      r.replay.perspective = "red";
    },
  ],
  [
    "fresh opening",
    (r: RecordEntry) => {
      r.replay.seed++;
    },
  ],
  [
    "changed player deck order",
    (r: RecordEntry) => {
      r.replay.deck.reverse();
    },
  ],
  [
    "changed opponent deck order",
    (r: RecordEntry) => {
      r.replay.enemyDeck.reverse();
    },
  ],
  [
    "wrong opponent name",
    (r: RecordEntry) => {
      r.opponent = `Other · 2020-02-29`;
    },
  ],
  [
    "invalid date",
    (r: RecordEntry) => {
      r.opponent = `Trainer · 2026-02-30`;
    },
  ],
  [
    "year zero",
    (r: RecordEntry) => {
      r.opponent = `Trainer · 0000-01-01`;
    },
  ],
] as const)(
  "does not label a %s as the unchanged daily matchup",
  (_, change) => {
    const record = dailyRecord();
    change(record);
    expect(recordedDailyDate(record)).toBeUndefined();
  },
);
