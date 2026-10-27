import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportProgress,
  importProgress,
  loadProfile,
  MAX_BACKUP_BYTES,
  recordBattle,
} from "../src/game/profile";
import { Battle } from "../src/game/engine";
import legacy from "./fixtures/legacy-replay.json";
import combatV2 from "./fixtures/combat-v2-replay.json";
import combatV3 from "./fixtures/combat-v3-replay.json";
import combatV4 from "./fixtures/combat-v4-replay.json";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
  });
});

describe("portable progress backups", () => {
  it("round-trips decks, preferences, rewards and every supported replay version without writing storage", () => {
    const profile = loadProfile();
    profile.name = "👑 Backup King";
    profile.decks[2][0] = "poison";
    profile.decks[2][1] = "freeze";
    profile.activeDeck = 2;
    profile.deck = [...profile.decks[2]];
    profile.emotesMuted = true;
    const battle = new Battle({ seed: 42, ai: false, deck: profile.deck });
    battle.finish("blue", "Victory");
    recordBattle(profile, battle, {
      opponent: "Sky Captain",
      opponentType: "ai",
    });
    for (const fixture of [legacy, combatV2, combatV3, combatV4])
      profile.history.push({
        ...profile.history[0],
        replay: { ...fixture.replay, rulesFamily: "origin" } as any,
      });
    vi.mocked(localStorage.setItem).mockClear();
    const restored = importProgress(exportProgress(profile));
    expect(restored).toEqual(profile);
    expect(restored.history.map((entry) => entry.replay.version)).toEqual([
      42, 1, 2, 3, 4,
    ]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    restored.deck[0] = "knight";
    expect(profile.deck[0]).toBe("poison");
  });

  it("rejects incomplete and incompatible files instead of silently resetting progress", () => {
    const backup = JSON.parse(exportProgress(loadProfile()));
    const candidates = [
      "{broken",
      "null",
      "[]",
      "{}",
      JSON.stringify(backup.profile),
      JSON.stringify({ ...backup, version: 2 }),
      JSON.stringify({ ...backup, format: "another-game" }),
      JSON.stringify({ ...backup, profile: { version: 1 } }),
    ];
    for (const text of candidates) expect(() => importProgress(text)).toThrow();
    for (const mutate of [
      (p: any) => {
        p.deck[0] = "constructor";
      },
      (p: any) => {
        p.chests = [["silver"]];
      },
      (p: any) => {
        p.gold = -1;
      },
      (p: any) => {
        p.name = "bad\u0000name";
      },
      (p: any) => {
        p.history = [null];
      },
    ]) {
      const corrupt = structuredClone(backup);
      mutate(corrupt.profile);
      expect(() => importProgress(JSON.stringify(corrupt))).toThrow(
        "incomplete or invalid progress",
      );
    }
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("bounds file bytes before parsing, including multibyte text", () => {
    expect(() => importProgress(" ".repeat(MAX_BACKUP_BYTES + 1))).toThrow(
      "smaller than 2 MB",
    );
    expect(() => importProgress("👑".repeat(MAX_BACKUP_BYTES / 4 + 1))).toThrow(
      "smaller than 2 MB",
    );
  });
});
