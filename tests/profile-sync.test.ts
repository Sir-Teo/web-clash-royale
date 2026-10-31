import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadProfile,
  readSavedProfile,
  saveProfile,
  storageAvailable,
  PROFILE_STORAGE_KEY,
} from "../src/game/profile";

const data = new Map<string, string>();
const write = vi.fn((key: string, value: string) => {
  data.set(key, value);
});
beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: write,
  });
  saveProfile(loadProfile());
  data.clear();
  write.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it("returns no passive update for missing data while initial loading keeps its playable fallback", () => {
  expect(readSavedProfile()).toBeNull();
  expect(loadProfile().deck).toHaveLength(8);
  expect(write).not.toHaveBeenCalled();
});

it("ignores malformed, incomplete and repaired snapshots instead of manufacturing passive progress", () => {
  const profile = loadProfile();
  for (const raw of [
    "not json",
    "null",
    JSON.stringify({ version: 1, name: "Partial" }),
    JSON.stringify({ ...profile, gold: -1 }),
    JSON.stringify({ ...profile, deck: Array(8).fill("knight") }),
  ]) {
    data.set(PROFILE_STORAGE_KEY, raw);
    expect(readSavedProfile()).toBeNull();
    expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  }
  expect(write).not.toHaveBeenCalled();
});

it("reads a complete saved snapshot without rewriting its formatting or source", () => {
  const profile = loadProfile();
  profile.name = "Stored King";
  profile.gold = 5432;
  const raw = JSON.stringify(profile, null, 2);
  data.set(PROFILE_STORAGE_KEY, raw);
  const loaded = readSavedProfile();
  expect(loaded).toEqual(profile);
  expect(loaded).not.toBe(profile);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});

it("returns no passive update when browser storage becomes unreadable", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("Storage blocked");
    },
    setItem: write,
  });
  expect(readSavedProfile()).toBeNull();
  expect(loadProfile().deck).toHaveLength(8);
  expect(write).not.toHaveBeenCalled();
});

it("does not treat a readable snapshot as proof that failed writes have recovered", () => {
  const profile = loadProfile();
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem() {
      throw new Error("Storage full");
    },
  });
  saveProfile(profile);
  expect(storageAvailable).toBe(false);
  expect(readSavedProfile()).toEqual(profile);
  expect(storageAvailable).toBe(false);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: write,
  });
  saveProfile(profile);
});
