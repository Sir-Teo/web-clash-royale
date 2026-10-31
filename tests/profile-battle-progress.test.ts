import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Battle, type Mode, type Team } from "../src/game/engine";
import { PRESETS } from "../src/game/cards";
import {
  loadProfile,
  saveProfile,
  saveBattleResult,
  recordBattle,
  storageAvailable,
  PROFILE_STORAGE_KEY,
} from "../src/game/profile";

const data = new Map<string, string>();
let blocked = false;
const read = vi.fn((key: string) => data.get(key) ?? null);
const write = vi.fn((key: string, value: string) => {
  if (blocked) throw new Error("Storage full");
  data.set(key, value);
});
beforeEach(() => {
  data.clear();
  blocked = false;
  vi.stubGlobal("localStorage", { getItem: read, setItem: write });
  saveProfile(loadProfile());
  data.clear();
  read.mockClear();
  write.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
function profiles() {
  const profile = loadProfile();
  Object.assign(profile, {
    name: "Earlier Captain",
    trophies: 100,
    gold: 2000,
  });
  saveProfile(profile);
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Newer Captain",
    trophies: 200,
    best: 300,
    gold: 9000,
    battles: 12,
    wins: 4,
    crowns: 15,
    chests: [],
    deck: [...PRESETS[1].deck],
    activeDeck: 1,
    sound: true,
    music: true,
    emotesMuted: true,
  });
  latest.decks[1] = [...PRESETS[1].deck];
  latest.history = [
    {
      id: 1,
      date: "2026-10-30T12:00:00.000Z",
      mode: "classic",
      winner: "red",
      crowns: [0, 0],
      playerName: latest.name,
      opponent: "Previous Rival",
      opponentType: "ai",
      replay: new Battle({ ai: false, seed: 2 }).exportReplay(),
    },
  ];
  return { profile, latest };
}
function completed(
  winner: Team | "draw" = "blue",
  mode: Mode = "classic",
  seed = 19,
) {
  const battle = new Battle({ ai: false, seed, mode });
  battle.players.blue.crowns = winner === "blue" ? 3 : 0;
  battle.finish(winner, "Finished test battle");
  return battle;
}

it("adds ranked rewards to the latest saved counters, chest capacity and history while retaining the captured identity", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  const reward = saveBattleResult(profile, completed(), {
    opponent: "Captured Rival",
    opponentType: "ai",
  });
  expect(reward).toEqual({ trophies: 30, gold: 125, chest: "magical" });
  expect({ ...profile, history: latest.history }).toEqual({
    ...latest,
    trophies: 230,
    gold: 9125,
    wins: 5,
    battles: 13,
    crowns: 18,
    chests: ["magical"],
  });
  expect(profile.history.slice(1)).toEqual(latest.history);
  expect(profile.history[0]).toMatchObject({
    playerName: "Earlier Captain",
    opponent: "Captured Rival",
    replay: { deck: completed().deck },
  });
  expect(loadProfile()).toEqual(profile);
  expect(latest.history).toHaveLength(1);
});

it("clamps a ranked loss against current saved trophies", () => {
  const { profile, latest } = profiles();
  latest.trophies = 4;
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  expect(saveBattleResult(profile, completed("red"))).toEqual({
    trophies: -4,
    gold: 25,
    chest: null,
  });
  expect(profile).toMatchObject({
    trophies: 0,
    best: 300,
    gold: 9025,
    battles: 13,
    wins: 4,
    crowns: 15,
    chests: [],
  });
});

it.each([{ practice: true }, { friendly: true }])(
  "keeps newer progress when recording a non-ranked result %j",
  (options) => {
    const { profile, latest } = profiles();
    data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
    expect(saveBattleResult(profile, completed(), options)).toEqual({
      trophies: 0,
      gold: 0,
      chest: null,
    });
    expect(profile).toMatchObject({
      name: latest.name,
      trophies: 200,
      gold: 9000,
      battles: 13,
      wins: 5,
      crowns: 18,
      chests: [],
    });
    expect(profile.history).toHaveLength(2);
  },
);

it("finds an already recorded friendly match in the latest snapshot without writing it twice", () => {
  const { profile, latest } = profiles();
  latest.history[0].matchId = "shared-match";
  const raw = JSON.stringify(latest, null, 2);
  data.set(PROFILE_STORAGE_KEY, raw);
  write.mockClear();
  expect(
    saveBattleResult(profile, completed(), {
      friendly: true,
      matchId: "shared-match",
    }),
  ).toEqual({ trophies: 0, gold: 0, chest: null });
  expect(profile).toEqual(latest);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});

it("retains unsaved session results and rewards when a failed write later recovers", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  recordBattle(profile, completed("red"), { practice: true });
  expect(storageAvailable).toBe(false);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  saveBattleResult(profile, completed("red", "double", 20), { practice: true });
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    battles: 2,
  });
  expect(profile.history).toHaveLength(2);
  expect(profile.history.map((record) => record.replay.seed)).toEqual([20, 19]);
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});

it("uses the session profile when the saved snapshot cannot be trusted", () => {
  const { profile } = profiles();
  profile.gold = 9876;
  data.set(PROFILE_STORAGE_KEY, "broken JSON");
  saveBattleResult(profile, completed("red"), { practice: true });
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    battles: 1,
  });
  expect(loadProfile()).toEqual(profile);
});

it("leaves an unfinished battle and profile untouched without reading or writing progress", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  const before = structuredClone(profile);
  read.mockClear();
  write.mockClear();
  expect(saveBattleResult(profile, new Battle({ ai: false }))).toEqual({
    trophies: 0,
    gold: 0,
    chest: null,
  });
  expect(profile).toEqual(before);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
