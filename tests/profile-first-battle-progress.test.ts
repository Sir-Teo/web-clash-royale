import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PRESETS } from "../src/game/cards";
import {
  loadProfile,
  saveProfile,
  markTutorialSeen,
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
    seenTutorial: false,
  });
  saveProfile(profile);
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Newer Captain",
    gold: 9000,
    battles: 12,
    deck: [...PRESETS[1].deck],
    activeDeck: 1,
    music: true,
    emotesMuted: true,
  });
  latest.decks[1] = [...PRESETS[1].deck];
  return { profile, latest };
}

it("marks first-battle completion on current saved progress", () => {
  const { profile, latest } = profiles();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  markTutorialSeen(profile);
  expect(profile).toEqual({ ...latest, seenTutorial: true });
  expect(loadProfile()).toEqual(profile);
  expect(latest.seenTutorial).toBe(false);
});

it("refreshes an already completed flag without rewriting the current saved snapshot", () => {
  const { profile, latest } = profiles();
  latest.seenTutorial = true;
  const raw = JSON.stringify(latest, null, 2);
  data.set(PROFILE_STORAGE_KEY, raw);
  write.mockClear();
  markTutorialSeen(profile);
  expect(profile).toEqual(latest);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});

it("keeps unsaved session progress when a known failed write recovers", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  expect(storageAvailable).toBe(false);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  blocked = false;
  markTutorialSeen(profile);
  expect(profile).toMatchObject({
    name: "Earlier Captain",
    gold: 9876,
    seenTutorial: true,
  });
  expect(loadProfile()).toEqual(profile);
  expect(storageAvailable).toBe(true);
});

it("keeps the completed flag for this session when persistence is blocked", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest);
  data.set(PROFILE_STORAGE_KEY, raw);
  blocked = true;
  markTutorialSeen(profile);
  expect(profile).toEqual({ ...latest, seenTutorial: true });
  expect(storageAvailable).toBe(false);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
});

it("uses the session profile when the saved snapshot is untrusted", () => {
  const { profile } = profiles();
  const before = structuredClone(profile);
  data.set(PROFILE_STORAGE_KEY, "broken JSON");
  markTutorialSeen(profile);
  expect(profile).toEqual({ ...before, seenTutorial: true });
  expect(loadProfile()).toEqual(profile);
});
