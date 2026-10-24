import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadProfile,
  saveProfile,
  recordBattle,
  openChest,
} from "../src/game/profile";
import { Battle } from "../src/game/engine";
import legacy from "./fixtures/legacy-replay.json";
import combatV2 from "./fixtures/combat-v2-replay.json";
import combatV3 from "./fixtures/combat-v3-replay.json";
import combatV4 from "./fixtures/combat-v4-replay.json";
import type { Replay } from "../src/game/engine";
import { applySnapshot, snapshot } from "../src/network/perspective";
const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
});
describe("local progress", () => {
  it("saves friendly red-side replays without rewards or duplicate reconnect records", () => {
    const p = loadProfile();
    const canonical = new Battle({ ai: false, seed: 16 });
    canonical.play("red", 0, 14, 10);
    canonical.step();
    canonical.finish("red", "Surrender");
    const view = new Battle({ ai: false });
    applySnapshot(view, snapshot(canonical), "red");
    const metadata = {
      friendly: true,
      opponent: "Blue King",
      matchId: "ABC234",
      replay: { ...canonical.exportReplay(), perspective: "red" as const },
    };
    expect(recordBattle(p, view, metadata)).toEqual({
      trophies: 0,
      gold: 0,
      chest: null,
    });
    recordBattle(p, view, metadata);
    const saved = loadProfile();
    expect(saved.battles).toBe(1);
    expect(saved.wins).toBe(1);
    expect(saved.gold).toBe(1000);
    expect(saved.chests).toEqual([]);
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].winner).toBe("blue");
    expect(saved.history[0].opponent).toBe("Blue King");
    expect(saved.history[0].replay).toEqual(metadata.replay);
  });
  it("preserves both legacy and current replays across reload and rejects future versions", () => {
    const p = loadProfile(),
      b = new Battle({ ai: false, seed: 1 });
    b.finish("blue", "Win");
    recordBattle(p, b);
    const old = { ...p.history[0], id: 2, replay: legacy.replay as Replay };
    p.history.push(old);
    p.history.push({ ...old, id: 3, replay: combatV2.replay as Replay });
    p.history.push({ ...old, id: 4, replay: combatV3.replay as Replay });
    p.history.push({ ...old, id: 5, replay: combatV4.replay as Replay });
    p.history.push({ ...old, id: 6, replay: { ...old.replay, version: 5 } });
    p.history.push({ ...old, id: 7, replay: { ...old.replay, version: 6 } });
    p.history.push({ ...old, id: 8, replay: { ...old.replay, version: 7 } });
    saveProfile(p);
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      8, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const raw = JSON.parse(data.get("browser-royale.profile.v1")!);
    raw.history[0].replay.version = 99;
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
  it("recovers from corrupt data and rejects duplicate deck cards", () => {
    data.set("browser-royale.profile.v1", "{broken");
    expect(loadProfile().deck).toHaveLength(8);
    const p = loadProfile();
    p.deck = Array(8).fill("knight");
    saveProfile(p);
    expect(new Set(loadProfile().deck).size).toBe(8);
  });
  it("awards a chest for ranked wins and allows each chest to be claimed once", () => {
    const p = loadProfile(),
      b = new Battle({ seed: 1, ai: false });
    b.finish("blue", "Test victory");
    const reward = recordBattle(p, b);
    expect(reward).toEqual({ trophies: 30, gold: 125, chest: "silver" });
    expect(p.history).toHaveLength(1);
    expect(openChest(p, 0)?.gold).toBe(150);
    expect(openChest(p, 0)).toBeNull();
    expect(p.gold).toBe(1275);
  });
  it("keeps training separate from ranked rewards", () => {
    const p = loadProfile(),
      b = new Battle({ seed: 1, ai: false, mode: "training" });
    b.finish("blue", "Training victory");
    recordBattle(p, b);
    expect(p.trophies).toBe(0);
    expect(p.gold).toBe(1000);
    expect(p.chests).toHaveLength(0);
    expect(p.history).toHaveLength(1);
  });
  it("caps history and chest slots while preserving nonnegative trophies", () => {
    const p = loadProfile();
    for (let i = 0; i < 12; i++) {
      const b = new Battle({ seed: i, ai: false });
      b.finish("blue", "Win");
      recordBattle(p, b);
    }
    expect(p.history).toHaveLength(10);
    expect(p.chests).toHaveLength(4);
    p.trophies = 4;
    const loss = new Battle({ ai: false });
    loss.finish("red", "Loss");
    expect(recordBattle(p, loss).trophies).toBe(-4);
    expect(p.trophies).toBe(0);
  });
});
