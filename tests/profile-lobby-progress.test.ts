import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import { PRESETS } from "../src/game/cards";
import {
  loadProfile,
  saveProfile,
  saveSoundPreference,
  selectSavedDeck,
  claimSavedChest,
  storageAvailable,
  PROFILE_STORAGE_KEY,
} from "../src/game/profile";

const data = new Map<string, string>();
let blocked = false;
const write = vi.fn((key: string, value: string) => {
  if (blocked) throw new Error("Storage full");
  data.set(key, value);
});
beforeEach(() => {
  data.clear();
  blocked = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: write,
  });
  saveProfile(loadProfile());
  data.clear();
  write.mockClear();
});
afterEach(() => {
  blocked = false;
  saveProfile(loadProfile());
  vi.unstubAllGlobals();
});
function profiles() {
  const profile = loadProfile();
  Object.assign(profile, {
    name: "Earlier Captain",
    gold: 2000,
    chests: ["gold", "silver"],
    sound: false,
  });
  saveProfile(profile);
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Newer Captain",
    gold: 9000,
    wins: 4,
    battles: 12,
    crowns: 15,
    activeDeck: 1,
    deck: [...PRESETS[1].deck],
    music: true,
    emotesMuted: true,
  });
  latest.decks[1] = [...PRESETS[1].deck];
  [latest.decks[0][0], latest.decks[0][1]] = [
    latest.decks[0][1],
    latest.decks[0][0],
  ];
  latest.history = [
    {
      id: 1,
      date: "2026-10-31T12:00:00.000Z",
      mode: "classic",
      winner: "red",
      crowns: [0, 0],
      playerName: latest.name,
      opponent: "Recorded Rival",
      opponentType: "ai",
      replay: new Battle({ ai: false, seed: 8 }).exportReplay(),
    },
  ];
  return { profile, latest };
}

it.each([true, false])(
  "saves requested sound %s on current progress",
  (sound) => {
    const { profile, latest } = profiles();
    profile.sound = !sound;
    latest.sound = !sound;
    data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
    saveSoundPreference(profile, sound);
    expect(profile).toEqual({ ...latest, sound });
    expect(loadProfile()).toEqual(profile);
  },
);
it("keeps a sound change in the session when writing is blocked", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest);
  data.set(PROFILE_STORAGE_KEY, raw);
  blocked = true;
  saveSoundPreference(profile, true);
  expect(profile).toEqual({ ...latest, sound: true });
  expect(storageAvailable).toBe(false);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
});
it("retains known unsaved progress when a sound save recovers", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  saveSoundPreference(profile, true);
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    sound: true,
  });
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});

it("selects the current saved slot contents without changing other slots or newer progress", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  expect(selectSavedDeck(profile, 0)).toBe(true);
  expect(profile).toEqual({ ...latest, activeDeck: 0, deck: latest.decks[0] });
  expect(profile.deck).not.toBe(profile.decks[0]);
  expect(loadProfile()).toEqual(profile);
});
it("keeps a selected slot for this session when writing is blocked", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest);
  data.set(PROFILE_STORAGE_KEY, raw);
  blocked = true;
  expect(selectSavedDeck(profile, 0)).toBe(true);
  expect(profile).toEqual({ ...latest, activeDeck: 0, deck: latest.decks[0] });
  expect(storageAvailable).toBe(false);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
});
it("retains local slot contents and unsaved progress when storage recovers", () => {
  const { profile, latest } = profiles();
  const localDeck = [...profile.decks[0]];
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  expect(selectSavedDeck(profile, 0)).toBe(true);
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    activeDeck: 0,
    deck: localDeck,
  });
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});

it("claims an unchanged chest slot on current gold, history and preferences", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  const result = claimSavedChest(profile, 0);
  expect(result).toMatchObject({
    status: "opened",
    reward: { type: "gold", gold: 350 },
  });
  expect(profile).toEqual({ ...latest, gold: 9350, chests: ["silver"] });
  expect(loadProfile()).toEqual(profile);
});
it("refreshes a consumed chest slot without claiming its new occupant or writing progress", () => {
  const { profile, latest } = profiles();
  latest.chests = ["silver"];
  const raw = JSON.stringify(latest, null, 2);
  data.set(PROFILE_STORAGE_KEY, raw);
  write.mockClear();
  expect(claimSavedChest(profile, 0)).toEqual({
    status: "changed",
    reward: null,
  });
  expect(profile).toEqual(latest);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});
it("detects changed chest order even when the slot count is unchanged", () => {
  const { profile, latest } = profiles();
  latest.chests = ["silver", "gold"];
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  write.mockClear();
  expect(claimSavedChest(profile, 0)).toEqual({
    status: "changed",
    reward: null,
  });
  expect(profile).toEqual(latest);
  expect(write).not.toHaveBeenCalled();
});
it("refreshes current progress without awarding a missing chest", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  write.mockClear();
  expect(claimSavedChest(profile, 99)).toEqual({
    status: "missing",
    reward: null,
  });
  expect(profile).toEqual(latest);
  expect(write).not.toHaveBeenCalled();
});
it("keeps a chest reward in the session when persistence fails", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest);
  data.set(PROFILE_STORAGE_KEY, raw);
  blocked = true;
  expect(claimSavedChest(profile, 0)).toMatchObject({
    status: "opened",
    reward: { type: "gold", gold: 350 },
  });
  expect(profile).toEqual({ ...latest, gold: 9350, chests: ["silver"] });
  expect(storageAvailable).toBe(false);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
});
it("claims against known unsaved session progress when writing recovers", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  latest.chests = [];
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  expect(claimSavedChest(profile, 0)).toMatchObject({
    status: "opened",
    reward: { type: "gold", gold: 350 },
  });
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 10226,
    chests: ["silver"],
  });
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});
