import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Battle, type Replay } from "../src/game/engine";
import type { RecordEntry } from "../src/game/profile";
import {
  exportReplayFile,
  importReplayFile,
  MAX_REPLAY_BYTES,
} from "../src/game/replay-file";
import { recordedDecks } from "../src/game/match-decks";

const record = (replay: Replay): RecordEntry => ({
  id: 42,
  date: "2026-10-24T12:00:00.000Z",
  mode: replay.mode,
  winner: "red",
  crowns: [0, 3],
  opponent: "Royal Trainer",
  opponentType: "ai",
  matchId: "private-room-id",
  replay,
});
const legacy = JSON.parse(
  readFileSync("tests/fixtures/legacy-replay.json", "utf8"),
).replay;
const v4 = JSON.parse(
  readFileSync("tests/fixtures/combat-v4-replay.json", "utf8"),
).replay;
const payload = () => JSON.parse(exportReplayFile(record(v4), "Sender King"));

describe("individual replay files", () => {
  it("round-trips all supported rules and only exports the recording", () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    const replays = [
      legacy,
      ...[2, 3, 4].map(
        (v) =>
          JSON.parse(
            readFileSync(`tests/fixtures/combat-v${v}-replay.json`, "utf8"),
          ).replay,
      ),
      new Battle({ seed: 42, ai: false }).exportReplay(),
    ];
    for (const replay of replays) {
      const original = record(replay),
        before = structuredClone(original);
      const text = exportReplayFile(original, "Sender King"),
        restored = importReplayFile(text);
      expect(restored.playerName).toBe("Sender King");
      expect(restored.record.replay).toEqual({
        ...replay,
        rulesFamily: replay.rulesFamily ?? "origin",
      });
      expect(restored.record).toMatchObject({
        date: original.date,
        winner: original.winner,
        crowns: original.crowns,
      });
      expect(JSON.parse(text).match).not.toHaveProperty("id");
      expect(JSON.parse(text).match).not.toHaveProperty("matchId");
      expect(JSON.parse(text)).not.toHaveProperty("profile");
      expect(original).toEqual(before);
      restored.record.replay.deck[0] = "rage";
      expect(original.replay.deck[0]).not.toBe("rage");
    }
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("preserves a red-side viewer's decks, result and canonical commands", () => {
    const replay = { ...v4, perspective: "red" as const };
    const original = record(replay);
    const restored = importReplayFile(exportReplayFile(original, "Red King"));
    expect(recordedDecks(restored.record).yours).toEqual(replay.enemyDeck);
    expect(recordedDecks(restored.record).opponent).toEqual(replay.deck);
    expect(restored.record.replay.actions).toEqual(replay.actions);
    expect(restored.record.crowns).toEqual(original.crowns);
  });
  it("rejects unrelated files, future formats and malformed JSON", () => {
    for (const text of [
      "not json",
      "null",
      "[]",
      JSON.stringify({
        format: "browser-royale-progress",
        version: 1,
        profile: {},
      }),
    ])
      expect(() => importReplayFile(text)).toThrow(/replay/i);
    const p = payload();
    p.version = 2;
    expect(() => importReplayFile(JSON.stringify(p))).toThrow(/replay/i);
    p.version = 1;
    p.match.replay.version = 19;
    expect(() => importReplayFile(JSON.stringify(p))).toThrow(/invalid/i);
  });
  it("bounds file bytes, names and recording duration", () => {
    expect(() => importReplayFile(" ".repeat(MAX_REPLAY_BYTES + 1))).toThrow(
      /512 KB/,
    );
    for (const mutate of [
      (p: any) => (p.playerName = "A".repeat(19)),
      (p: any) => (p.playerName = "Sender\nKing"),
      (p: any) => (p.match.opponent = "A".repeat(65)),
      (p: any) => (p.match.replay.duration = 9001),
      (p: any) => (p.match.date = "bad"),
    ]) {
      const p = payload();
      mutate(p);
      expect(() => importReplayFile(JSON.stringify(p))).toThrow(/invalid/i);
    }
    const p = payload();
    p.playerName = "👑 Sender";
    expect(importReplayFile(JSON.stringify(p)).playerName).toBe("👑 Sender");
  });
  it("rejects unknown fields, inherited card names, duplicate decks and commands outside the recorded deck", () => {
    for (const mutate of [
      (p: any) => (p.profile = {}),
      (p: any) => (p.match.gold = 1000),
      (p: any) => (p.match.replay.deck[0] = "toString"),
      (p: any) => (p.match.replay.deck[0] = p.match.replay.deck[1]),
      (p: any) => (p.match.replay.actions[0].card = "rocket"),
      (p: any) => (p.match.replay.actions[0].force = true),
    ]) {
      const p = payload();
      mutate(p);
      expect(() => importReplayFile(JSON.stringify(p))).toThrow(/invalid/i);
    }
  });
  it("rejects corrupt commands and preserves simultaneous command ordering", () => {
    for (const mutate of [
      (p: any) => (p.match.replay.actions[0].team = "green"),
      (p: any) => (p.match.replay.actions[0].x = 18),
      (p: any) => (p.match.replay.actions[0].y = 0.6),
      (p: any) => (p.match.replay.actions[1].tick = -1),
      (p: any) =>
        p.match.replay.actions.push({ ...p.match.replay.actions[0], tick: 0 }),
    ]) {
      const p = payload();
      mutate(p);
      expect(() => importReplayFile(JSON.stringify(p))).toThrow(/invalid/i);
    }
    const p = payload();
    p.match.replay.actions = [
      p.match.replay.actions[0],
      {
        ...p.match.replay.actions[0],
        team: "red",
        card: p.match.replay.enemyDeck[0],
      },
    ];
    expect(importReplayFile(JSON.stringify(p)).record.replay.actions).toEqual(
      p.match.replay.actions,
    );
  });
  it("retains names as plain data for safe UI escaping", () => {
    const p = payload();
    p.playerName = "<b>Sender</b>";
    p.match.opponent = '<img src=x onerror="bad()">';
    const shared = importReplayFile(JSON.stringify(p));
    expect(shared.playerName).toBe(p.playerName);
    expect(shared.record.opponent).toBe(p.match.opponent);
  });
});
