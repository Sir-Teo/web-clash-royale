import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadProfile,
  saveProfile,
  refreshProfileForDeckEdit,
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
afterEach(() => {
  blocked = false;
  saveProfile(loadProfile());
  vi.unstubAllGlobals();
});
function profiles() {
  const profile = loadProfile();
  Object.assign(profile, { name: "Earlier Captain", gold: 2000 });
  saveProfile(profile);
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Newer Captain",
    gold: 9000,
    battles: 12,
    sound: false,
    music: true,
    emotesMuted: true,
  });
  return { profile, latest };
}

it("keeps an unchanged complete profile without writing progress", () => {
  const { profile } = profiles();
  const before = structuredClone(profile);
  write.mockClear();
  expect(refreshProfileForDeckEdit(profile)).toBe("none");
  expect(profile).toEqual(before);
  expect(write).not.toHaveBeenCalled();
});

it("refreshes newer progress without invalidating unchanged saved decks or rewriting its formatting", () => {
  const { profile, latest } = profiles();
  const raw = JSON.stringify(latest, null, 2);
  data.set(PROFILE_STORAGE_KEY, raw);
  write.mockClear();
  expect(refreshProfileForDeckEdit(profile)).toBe("progress");
  expect(profile).toEqual(latest);
  expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});

it.each(["active", "order", "other slot"] as const)(
  "identifies a changed %s deck state before applying the current profile",
  (change) => {
    const { profile, latest } = profiles();
    if (change === "active") {
      latest.activeDeck = 1;
      latest.deck = [...latest.decks[1]];
    } else if (change === "order") {
      [latest.deck[0], latest.deck[1]] = [latest.deck[1], latest.deck[0]];
      latest.decks[latest.activeDeck] = [...latest.deck];
    } else {
      [latest.decks[1][0], latest.decks[1][1]] = [
        latest.decks[1][1],
        latest.decks[1][0],
      ];
    }
    const raw = JSON.stringify(latest);
    data.set(PROFILE_STORAGE_KEY, raw);
    write.mockClear();
    expect(refreshProfileForDeckEdit(profile)).toBe("decks");
    expect(profile).toEqual(latest);
    expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
    expect(write).not.toHaveBeenCalled();
  },
);

it("retains known session-only changes instead of reading a saved snapshot", () => {
  const { profile, latest } = profiles();
  profile.gold = 9876;
  blocked = true;
  saveProfile(profile);
  expect(storageAvailable).toBe(false);
  data.set(PROFILE_STORAGE_KEY, JSON.stringify(latest));
  read.mockClear();
  write.mockClear();
  expect(refreshProfileForDeckEdit(profile)).toBe("none");
  expect(profile).toMatchObject({ name: "Earlier Captain", gold: 9876 });
  expect(storageAvailable).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("keeps the session profile when saved progress is malformed or partial", () => {
  const { profile } = profiles();
  const before = structuredClone(profile);
  write.mockClear();
  for (const raw of [
    "broken JSON",
    JSON.stringify({ version: 1, name: "Partial" }),
  ]) {
    data.set(PROFILE_STORAGE_KEY, raw);
    expect(refreshProfileForDeckEdit(profile)).toBe("none");
    expect(profile).toEqual(before);
    expect(data.get(PROFILE_STORAGE_KEY)).toBe(raw);
  }
  expect(write).not.toHaveBeenCalled();
});
