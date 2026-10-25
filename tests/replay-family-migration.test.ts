import { afterEach, describe, expect, it, vi } from "vitest";
import { Battle, type Replay } from "../src/game/engine";
import {
  exportProgress,
  importProgress,
  loadProfile,
  validRecordEntry,
  type RecordEntry,
} from "../src/game/profile";
import { exportReplayFile, importReplayFile } from "../src/game/replay-file";

function record(): RecordEntry {
  const replay: Replay = {
    ...new Battle({ seed: 42, ai: false }).exportReplay(),
    version: 5,
  };
  delete replay.rulesFamily;
  return {
    id: 42,
    date: "2026-10-24T12:00:00.000Z",
    mode: "classic",
    winner: "blue",
    crowns: [3, 0],
    replay,
  };
}
function storage(value: unknown = null) {
  vi.stubGlobal("localStorage", {
    getItem: () => (value === null ? null : JSON.stringify(value)),
    setItem: vi.fn(),
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("historical replay family provenance", () => {
  it("tags old portable replay wrappers and preserves explicit families", () => {
    const saved = JSON.parse(exportReplayFile(record(), "King"));
    expect(saved.match.replay.rulesFamily).toBe("origin");
    delete saved.match.replay.rulesFamily;
    const migrated = importReplayFile(JSON.stringify(saved)).record;
    expect(migrated.replay.rulesFamily).toBe("local");
    expect(
      importReplayFile(exportReplayFile(migrated, "King")).record.replay
        .rulesFamily,
    ).toBe("local");
    saved.match.replay.rulesFamily = "origin";
    expect(
      importReplayFile(JSON.stringify(saved)).record.replay.rulesFamily,
    ).toBe("origin");
  });
  it("migrates only proven local storage records and leaves ambiguous bare recordings unchanged", () => {
    storage();
    const p = loadProfile();
    p.history = [
      record(),
      { ...record(), id: 43, playerName: "King" },
      { ...record(), id: 44, opponentType: "ai" },
    ];
    storage(p);
    expect(loadProfile().history.map((r) => r.replay.rulesFamily)).toEqual([
      undefined,
      "local",
      "local",
    ]);
    expect(new Battle({ replay: record().replay }).rulesFamily).toBe("origin");
    expect(record().replay.rulesFamily).toBeUndefined();
  });
  it("migrates old progress wrappers after strict validation and preserves tags in new backups", () => {
    storage();
    const p = loadProfile();
    p.history = [record()];
    const old = { format: "browser-royale-progress", version: 1, profile: p };
    const restored = importProgress(JSON.stringify(old));
    expect(restored.history[0].replay.rulesFamily).toBe("local");
    expect(importProgress(exportProgress(restored))).toEqual(restored);
    old.profile.history[0].replay.duration = 9001;
    expect(() => importProgress(JSON.stringify(old))).toThrow(/invalid/);
  });
  it("rejects invalid families, unsupported local versions and cards outside the frozen local roster", () => {
    for (const change of [
      (r: RecordEntry) => {
        (r.replay as any).rulesFamily = "future";
      },
      (r: RecordEntry) => {
        r.replay.rulesFamily = "local";
        r.replay.version = 6;
      },
      (r: RecordEntry) => {
        r.replay.rulesFamily = "local";
        r.replay.deck[0] = "mirror";
      },
      (r: RecordEntry) => {
        r.replay.rulesFamily = "local";
        r.replay.actions.push({
          tick: 0,
          team: "blue",
          card: "mirror",
          x: 4,
          y: 24,
        });
      },
    ]) {
      const r = record();
      change(r);
      expect(validRecordEntry(r)).toBe(false);
    }
  });
});
