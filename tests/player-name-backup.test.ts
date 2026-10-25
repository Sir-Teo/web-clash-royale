import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import {
  normalizePlayerName,
  loadProfile,
  recordBattle,
  exportProgress,
  importProgress,
} from "../src/game/profile";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";

const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  [" \u0000Royal\n King\u007f ", "Royal King"],
  ["\t \n\u0001\u007f", "Sir Teo"],
  ["a".repeat(17) + " b", "a".repeat(17)],
  ["a".repeat(16) + "👑x", "a".repeat(16) + "👑"],
  ["a".repeat(17) + "👑", "a".repeat(17)],
  [" 👑 Queen 👑 ", "👑 Queen 👑"],
  ["王様", "王様"],
  ["<b>Royal</b>", "<b>Royal</b>"],
  ["a".repeat(18), "a".repeat(18)],
  ["a".repeat(30), "a".repeat(18)],
  ["a".repeat(17) + "\ud83d", "a".repeat(17) + "\ud83d"],
])(
  "keeps the accepted name intact through storage, history and portable files (%j)",
  (raw, expected) => {
    const profile = loadProfile();
    profile.name = normalizePlayerName(raw);
    expect(profile.name).toBe(expected);
    expect(normalizePlayerName(profile.name)).toBe(expected);
    const battle = new Battle({ seed: 12, ai: false, mode: "training" });
    battle.finish("blue", "Name round trip");
    recordBattle(profile, battle, { friendly: true, playerName: raw });
    const restored = loadProfile();
    expect(restored).toEqual(profile);
    expect(restored.history).toHaveLength(1);
    expect(restored.history[0].playerName).toBe(expected);
    expect(importProgress(exportProgress(restored))).toEqual(restored);
    expect(
      importReplayFile(exportReplayFile(restored.history[0], restored.name))
        .playerName,
    ).toBe(expected);
  },
);
