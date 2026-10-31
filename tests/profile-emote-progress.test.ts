import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Battle } from "../src/game/engine";
import { PRESETS } from "../src/game/cards";
import {
  loadProfile,
  saveProfile,
  saveEmotePreference,
  storageAvailable,
  PROFILE_STORAGE_KEY,
} from "../src/game/profile";

const data = new Map<string, string>();
let blocked = false;
beforeEach(() => {
  data.clear();
  blocked = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("Storage full");
      data.set(key, value);
    },
  });
  saveProfile(loadProfile());
  data.clear();
});
afterEach(() => vi.unstubAllGlobals());
function profiles() {
  const profile = loadProfile();
  Object.assign(profile, {
    name: "Earlier Captain",
    gold: 2000,
    sound: false,
    music: false,
  });
  saveProfile(profile);
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Newer Captain",
    gold: 9000,
    battles: 12,
    wins: 4,
    crowns: 15,
    chests: [],
    deck: [...PRESETS[1].deck],
    activeDeck: 1,
    sound: true,
    music: true,
  });
  latest.decks[1] = [...PRESETS[1].deck];
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
  "saves an explicit emote preference %s without replacing newer progress",
  (muted) => {
    const { profile, latest } = profiles();
    profile.emotesMuted = !muted;
    latest.emotesMuted = !muted;
    data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
    saveEmotePreference(profile, muted);
    expect(profile).toEqual({ ...latest, emotesMuted: muted });
    expect(loadProfile()).toEqual(profile);
    expect(latest.emotesMuted).toBe(!muted);
  },
);

it("keeps unsaved session progress when a known failed write later recovers", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  expect(storageAvailable).toBe(false);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  saveEmotePreference(profile, true);
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    emotesMuted: true,
  });
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});

it("retains the requested session preference when its write is blocked", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest);
  data.set(PROFILE_STORAGE_KEY, raw);
  blocked = true;
  saveEmotePreference(profile, true);
  expect(profile).toEqual({ ...latest, emotesMuted: true });
  expect(storageAvailable).toBe(false);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
});

it("uses the current session when the saved profile cannot be trusted", () => {
  const { profile } = profiles();
  data.set(PROFILE_STORAGE_KEY, "broken JSON");
  const before = structuredClone(profile);
  saveEmotePreference(profile, true);
  expect(profile).toEqual({ ...before, emotesMuted: true });
  expect(loadProfile()).toEqual(profile);
});
