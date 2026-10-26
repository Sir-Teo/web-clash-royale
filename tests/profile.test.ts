import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadProfile,
  saveProfile,
  recordBattle,
  openChest,
  validDeck,
} from "../src/game/profile";
import { Battle } from "../src/game/engine";
import legacy from "./fixtures/legacy-replay.json";
import combatV2 from "./fixtures/combat-v2-replay.json";
import combatV3 from "./fixtures/combat-v3-replay.json";
import combatV4 from "./fixtures/combat-v4-replay.json";
import type { Replay } from "../src/game/engine";
import { applySnapshot, snapshot } from "../src/network/perspective";
import { STARTER_DECK } from "../src/game/cards";
const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
});
describe("local progress", () => {
  it("persists named AI opponents without changing ranked rewards or legacy records", () => {
    const p = loadProfile();
    const b = new Battle({ seed: 8, ai: false });
    b.finish("blue", "Win");
    expect(
      recordBattle(p, b, { opponent: "Sky Captain", opponentType: "ai" }),
    ).toEqual({ trophies: 30, gold: 125, chest: "silver" });
    expect(loadProfile().history[0]).toMatchObject({
      opponent: "Sky Captain",
      opponentType: "ai",
    });
    const raw = JSON.parse(data.get("browser-royale.profile.v1")!);
    raw.history.push({ ...raw.history[0], id: 9, opponentType: undefined });
    raw.history[0].opponentType = "unrecognized";
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history).toHaveLength(1);
    expect(loadProfile().history[0].opponentType).toBeUndefined();
  });
  it("rejects inherited property names as cards and recovers a playable deck", () => {
    for (const id of ["toString", "constructor", "__proto__"]) {
      const p = loadProfile();
      const deck = [...STARTER_DECK];
      deck[0] = id as any;
      expect(validDeck(deck)).toBe(false);
      p.deck = deck;
      saveProfile(p);
      const restored = loadProfile();
      expect(restored.deck).toEqual(STARTER_DECK);
      expect(() => new Battle({ deck })).toThrow("eight unique valid cards");
      expect(new Battle().canPlace("blue", id as any, 4, 20)).toMatchObject({
        ok: false,
        reason: "Unknown card.",
      });
    }
  });
  it("drops corrupt replay records while preserving valid neighboring history and progress", () => {
    const p = loadProfile();
    const b = new Battle({ ai: false, seed: 42 });
    b.play("blue", 0, 4, 20);
    b.step();
    b.finish("blue", "Win");
    recordBattle(p, b);
    const valid = structuredClone(p.history[0]);
    const mutations = [
      (r: any) => {
        r.date = "not a date";
      },
      (r: any) => {
        r.crowns = [4, 0];
      },
      (r: any) => {
        r.crowns = [0.5, 0];
      },
      (r: any) => {
        r.mode = "unknown";
      },
      (r: any) => {
        r.replay.seed = null;
      },
      (r: any) => {
        r.replay.mode = "double";
      },
      (r: any) => {
        r.replay.actions[0].card = "constructor";
      },
      (r: any) => {
        r.replay.actions[0].card = null;
      },
      (r: any) => {
        r.replay.actions[0].tick = r.replay.duration + 1;
      },
      (r: any) => {
        r.replay.actions = [
          { ...r.replay.actions[0], tick: 1 },
          { ...r.replay.actions[0], tick: 0 },
        ];
      },
    ];
    for (const mutate of mutations) {
      const corrupt = structuredClone(valid);
      mutate(corrupt);
      p.history = [valid, corrupt, { ...valid, id: valid.id + 1 }];
      saveProfile(p);
      const restored = loadProfile();
      expect(restored.history.map((r) => r.id)).toEqual([
        valid.id,
        valid.id + 1,
      ]);
      expect(restored.gold).toBe(p.gold);
      expect(restored.deck).toEqual(p.deck);
    }
  });
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
    p.history.push({ ...old, id: 9, replay: { ...old.replay, version: 8 } });
    p.history.push({ ...old, id: 10, replay: { ...old.replay, version: 9 } });
    p.history.push({ ...old, id: 11, replay: { ...old.replay, version: 10 } });
    p.history.push({ ...old, id: 12, replay: { ...old.replay, version: 11 } });
    p.history.push({ ...old, id: 13, replay: { ...old.replay, version: 12 } });
    p.history.push({ ...old, id: 14, replay: { ...old.replay, version: 13 } });
    p.history.push({ ...old, id: 15, replay: { ...old.replay, version: 14 } });
    p.history.push({ ...old, id: 16, replay: { ...old.replay, version: 15 } });
    saveProfile(p);
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      18, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const raw = JSON.parse(data.get("browser-royale.profile.v1")!);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    raw.history.shift();
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    raw.history[0].replay.version = 99;
    data.set("browser-royale.profile.v1", JSON.stringify(raw));
    expect(loadProfile().history.map((r) => r.replay.version)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15,
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
