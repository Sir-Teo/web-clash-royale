import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import {
  loadProfile,
  saveProfile,
  recordBattle,
  validRecordEntry,
  exportProgress,
  importProgress,
  type RecordEntry,
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
function finished() {
  const b = new Battle({ ai: false, seed: 42 });
  b.finish("blue", "Surrender");
  return b;
}
function record(): RecordEntry {
  return {
    id: 42,
    date: "2026-10-24T12:00:00.000Z",
    mode: "classic",
    winner: "blue",
    crowns: [0, 0],
    replay: finished().exportReplay(),
  };
}
describe("recorded player identity", () => {
  it("retains the captured battle name through later profile edits, storage and backup restore", () => {
    const p = loadProfile();
    p.name = "Future King";
    recordBattle(p, finished(), {
      friendly: true,
      matchId: "first",
      playerName: "Original King",
    });
    recordBattle(p, finished(), { friendly: true, matchId: "second" });
    p.name = "Latest King";
    saveProfile(p);
    const restored = loadProfile();
    expect(restored.name).toBe("Latest King");
    expect(restored.history.map((r) => r.playerName)).toEqual([
      "Future King",
      "Original King",
    ]);
    const imported = importProgress(exportProgress(restored));
    expect(imported).toEqual(restored);
    expect(imported.history[1].playerName).toBe("Original King");
  });
  it("does not relabel a duplicate friendly record after the profile name changes", () => {
    const p = loadProfile();
    recordBattle(p, finished(), {
      friendly: true,
      matchId: "round",
      playerName: "Battle King",
    });
    const before = structuredClone(p);
    p.name = "Future King";
    recordBattle(p, finished(), {
      friendly: true,
      matchId: "round",
      playerName: "Future King",
    });
    expect(p.history).toEqual(before.history);
    expect(p.battles).toBe(before.battles);
    expect(p.gold).toBe(before.gold);
  });
  it("normalizes captured names with the existing profile rules", () => {
    const p = loadProfile();
    for (const [name, expected] of [
      ["  King\nTeo  ", "KingTeo"],
      ["x".repeat(30), "x".repeat(18)],
      ["\t\n", "Sir Teo"],
      ["👑 Royal Teo", "👑 Royal Teo"],
    ]) {
      recordBattle(p, finished(), { friendly: true, playerName: name });
      expect(p.history[0].playerName).toBe(expected);
      expect(validRecordEntry(p.history[0])).toBe(true);
    }
  });
  it.each([undefined, "Original King", "<b>King</b>", "👑 Teo"])(
    "accepts optional name %s across every supported replay version and perspective",
    (playerName) => {
      for (const version of [1, 2, 3, 4, 5])
        for (const perspective of [undefined, "blue", "red"]) {
          const r = record();
          Object.assign(r.replay, { version, perspective });
          if (playerName !== undefined) r.playerName = playerName;
          expect(validRecordEntry(r)).toBe(true);
        }
    },
  );
  it.each(["", "   ", "x".repeat(19), " King", "King ", "King\nTeo", null, 42])(
    "rejects malformed captured name %j",
    (playerName) => {
      expect(validRecordEntry({ ...record(), playerName })).toBe(false);
    },
  );
  it("keeps legacy records without inventing a past name and rejects corrupt backup identity atomically", () => {
    const p = loadProfile(),
      legacy = record();
    p.name = "Current King";
    p.history = [legacy, { ...record(), id: 43, playerName: "Recorded King" }];
    saveProfile(p);
    expect(loadProfile().history[0]).not.toHaveProperty("playerName");
    const text = exportProgress(p);
    expect(importProgress(text)).toEqual(p);
    const broken = JSON.parse(text);
    broken.profile.history[1].playerName = 42;
    expect(() => importProgress(JSON.stringify(broken))).toThrow(
      /invalid progress/,
    );
    expect(loadProfile()).toEqual(p);
    data.set("browser-royale.profile.v1", JSON.stringify(broken.profile));
    expect(loadProfile().history).toEqual([legacy]);
  });
});
describe("replay file player identity", () => {
  it("exports the recorded name through the existing envelope and carries it through a second export", () => {
    const original = {
        ...record(),
        playerName: "Recorded King",
        matchId: "private",
      },
      before = structuredClone(original);
    const text = exportReplayFile(original, "Current King"),
      payload = JSON.parse(text);
    expect(payload.playerName).toBe("Recorded King");
    expect(payload.version).toBe(1);
    expect(payload.match).not.toHaveProperty("playerName");
    expect(payload.match).not.toHaveProperty("matchId");
    expect(payload.match).not.toHaveProperty("id");
    const imported = importReplayFile(text);
    expect(imported.playerName).toBe("Recorded King");
    expect(imported.record.playerName).toBe("Recorded King");
    expect(
      JSON.parse(exportReplayFile(imported.record, "Receiver King")).playerName,
    ).toBe("Recorded King");
    expect(original).toEqual(before);
  });
  it("uses the supplied fallback only for legacy records and promotes the shared envelope name", () => {
    const legacy = record();
    const imported = importReplayFile(
      exportReplayFile(legacy, "Fallback King"),
    );
    expect(imported.playerName).toBe("Fallback King");
    expect(imported.record.playerName).toBe("Fallback King");
    expect(legacy).not.toHaveProperty("playerName");
    const malformed = JSON.parse(exportReplayFile(legacy, "Fallback King"));
    malformed.match.playerName = "Other King";
    expect(() => importReplayFile(JSON.stringify(malformed))).toThrow(
      /invalid/,
    );
  });
});
