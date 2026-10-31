import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applySettingsDraft, loadProfile } from "../src/game/profile";
import { PRESETS } from "../src/game/cards";

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());
function profiles() {
  const profile = loadProfile();
  Object.assign(profile, { name: "Original King", sound: false, music: false });
  const latest = structuredClone(profile);
  Object.assign(latest, {
    name: "Other Captain",
    gold: 9000,
    battles: 13,
    wins: 5,
    crowns: 18,
    deck: [...PRESETS[1].deck],
    activeDeck: 1,
    chests: [],
    sound: true,
    music: true,
    emotesMuted: true,
  });
  return { profile, latest };
}

it("keeps newer progress and untouched preferences while applying an edited normalized name", () => {
  const { profile, latest } = profiles();
  const saved = structuredClone(latest);
  const draft = { name: "  Local Captain  ", sound: false, music: false };
  // A caller may supply the live profile as the original settings view.
  applySettingsDraft(profile, profile, draft, latest);
  expect(profile).toEqual({ ...latest, name: "Local Captain" });
  expect(latest).toEqual(saved);
  expect(draft).toEqual({
    name: "  Local Captain  ",
    sound: false,
    music: false,
  });
});

it("lets edited audio values win while retaining a newer unedited name", () => {
  const { profile, latest } = profiles();
  profile.sound = true;
  const original = { name: profile.name, sound: true, music: false };
  applySettingsDraft(
    profile,
    original,
    { name: original.name, sound: false, music: true },
    latest,
  );
  expect(profile).toEqual({ ...latest, sound: false, music: true });
});

it("retains the complete latest snapshot when no settings fields changed", () => {
  const { profile, latest } = profiles();
  const original = {
    name: profile.name,
    sound: profile.sound,
    music: profile.music,
  };
  applySettingsDraft(profile, original, original, latest);
  expect(profile).toEqual(latest);
});

it("keeps unsaved session progress when no trusted saved snapshot is supplied", () => {
  const { profile } = profiles();
  profile.gold = 9876;
  profile.chests = ["magical"];
  const before = structuredClone(profile);
  applySettingsDraft(
    profile,
    { name: profile.name, sound: false, music: false },
    { name: " Session Captain ", sound: true, music: true },
  );
  expect(profile).toEqual({
    ...before,
    name: "Session Captain",
    sound: true,
    music: true,
  });
});

it("does not treat formatting-equivalent names as an edit over a newer saved name", () => {
  const { profile, latest } = profiles();
  applySettingsDraft(
    profile,
    { name: "Original King", sound: false, music: false },
    { name: "  Original King  ", sound: false, music: false },
    latest,
  );
  expect(profile).toEqual(latest);
});
