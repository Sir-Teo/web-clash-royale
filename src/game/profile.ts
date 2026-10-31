import { isPlayableCard } from "./playable-cards";
import { CARDS, STARTER_DECK } from "./cards";
import { LOCAL_REPLAY_CARDS, migrateLocalRecord } from "./replay-family";
import type { CardId } from "./cards";
import type { Battle, Mode, Replay } from "./engine";
export interface RecordEntry {
  playerName?: string;
  opponent?: string;
  opponentType?: "ai" | "friend";
  practice?: true;
  matchId?: string;
  id: number;
  winner: "blue" | "red" | "draw";
  crowns: [number, number];
  mode: Mode;
  replay: Replay;
  date: string;
}
export interface Profile {
  version: 1;
  name: string;
  trophies: number;
  best: number;
  gold: number;
  wins: number;
  battles: number;
  crowns: number;
  deck: CardId[];
  decks: CardId[][];
  activeDeck: number;
  chests: ("silver" | "gold" | "magical")[];
  history: RecordEntry[];
  sound: boolean;
  music: boolean;
  emotesMuted: boolean;
  seenTutorial: boolean;
}
export const PROFILE_STORAGE_KEY = "browser-royale.profile.v1";
const base = (): Profile => ({
  version: 1,
  name: "Sir Teo",
  trophies: 0,
  best: 0,
  gold: 1000,
  wins: 0,
  battles: 0,
  crowns: 0,
  deck: [...STARTER_DECK],
  decks: [
    [...STARTER_DECK],
    [
      "hog-rider",
      "musketeer",
      "cannon",
      "skeletons",
      "goblins",
      "fireball",
      "zap",
      "valkyrie",
    ],
    [
      "balloon",
      "baby-dragon",
      "minions",
      "knight",
      "archers",
      "arrows",
      "fireball",
      "skeletons",
    ],
  ],
  activeDeck: 0,
  chests: [],
  history: [],
  sound: true,
  music: false,
  emotesMuted: false,
  seenTutorial: false,
});
export const validDeck = (a: unknown): a is CardId[] =>
  Array.isArray(a) &&
  a.length === 8 &&
  new Set(a).size === 8 &&
  a.every(isPlayableCard);
export function normalizePlayerName(value: string) {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // Keep the existing code-unit limit without cutting a surrogate pair.
  const limit = (name.codePointAt(17) ?? 0) > 0xffff ? 17 : 18;
  return name.slice(0, limit).trimEnd() || "Sir Teo";
}
type ProfileSettings = Readonly<Pick<Profile, "name" | "sound" | "music">>;

/** Apply edited fields to current saved progress without discarding session-only state. */
export function applySettingsDraft(
  profile: Profile,
  original: ProfileSettings,
  draft: ProfileSettings,
  latest: Readonly<Profile> | null = null,
) {
  const name = normalizePlayerName(draft.name);
  const nameChanged = name !== normalizePlayerName(original.name);
  const soundChanged = draft.sound !== original.sound;
  const musicChanged = draft.music !== original.music;
  if (latest) Object.assign(profile, latest);
  if (!latest || nameChanged) profile.name = name;
  if (!latest || soundChanged) profile.sound = draft.sound;
  if (!latest || musicChanged) profile.music = draft.music;
}
export function validRecordEntry(value: unknown): value is RecordEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as RecordEntry;
  return (
    r &&
    Number.isFinite(r.id) &&
    typeof r.date === "string" &&
    Number.isFinite(Date.parse(r.date)) &&
    ["classic", "double", "training"].includes(r.mode) &&
    (r.playerName === undefined ||
      (typeof r.playerName === "string" &&
        r.playerName.length > 0 &&
        r.playerName.length <= 18 &&
        r.playerName === r.playerName.trim() &&
        !/[\u0000-\u001f\u007f]/.test(r.playerName))) &&
    (r.opponent === undefined || typeof r.opponent === "string") &&
    (r.opponentType === undefined ||
      ["ai", "friend"].includes(r.opponentType)) &&
    (r.matchId === undefined || typeof r.matchId === "string") &&
    (r.practice === undefined || r.practice === true) &&
    (r.replay?.perspective === undefined ||
      ["blue", "red"].includes(r.replay.perspective)) &&
    ["blue", "red", "draw"].includes(r.winner) &&
    Array.isArray(r.crowns) &&
    r.crowns.length === 2 &&
    r.crowns.every((n) => Number.isInteger(n) && n >= 0 && n <= 3) &&
    (r.replay?.rulesFamily === undefined ||
      ["local", "origin"].includes(r.replay.rulesFamily)) &&
    (r.replay?.rulesFamily !== "local" || r.replay.version <= 5) &&
    Number.isInteger(r.replay?.version) &&
    r.replay.version >= 1 &&
    r.replay.version <= 56 &&
    Number.isSafeInteger(r.replay.seed) &&
    r.replay.mode === r.mode &&
    Number.isInteger(r.replay.duration) &&
    r.replay.duration >= 0 &&
    r.replay.duration <= 9000 &&
    validDeck(r.replay.deck) &&
    validDeck(r.replay.enemyDeck) &&
    (r.replay.rulesFamily !== "local" ||
      [...r.replay.deck, ...r.replay.enemyDeck].every((id) =>
        LOCAL_REPLAY_CARDS.has(id),
      )) &&
    Array.isArray(r.replay.actions) &&
    r.replay.actions.length <= 2000 &&
    r.replay.actions.every(
      (a, index, actions) =>
        a &&
        Number.isInteger(a.tick) &&
        a.tick >= 0 &&
        a.tick <= r.replay.duration &&
        (index === 0 || a.tick >= actions[index - 1].tick) &&
        ["blue", "red"].includes(a.team) &&
        isPlayableCard(a.card) &&
        (r.replay.rulesFamily !== "local" || LOCAL_REPLAY_CARDS.has(a.card)) &&
        Number.isFinite(a.x) &&
        Number.isFinite(a.y),
    )
  );
}

export function loadProfile(): Profile {
  try {
    return (
      decodeProfile(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "") ?? base()
    );
  } catch {
    return base();
  }
}
/** Passive updates require a complete snapshot; startup recovery still uses loadProfile. */
export function readSavedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const profile = decodeProfile(raw);
    if (
      !profile ||
      !Object.keys(profile).every(
        (key) =>
          JSON.stringify(profile[key as keyof Profile]) ===
          JSON.stringify(saved[key]),
      )
    )
      return null;
    return profile;
  } catch {
    return null;
  }
}
function decodeProfile(raw: string): Profile | null {
  const p = base();
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1) return null;
    for (const key of [
      "trophies",
      "best",
      "gold",
      "wins",
      "battles",
      "crowns",
    ] as const)
      if (Number.isFinite(saved[key]) && saved[key] >= 0)
        p[key] = Math.floor(saved[key]);
    if (typeof saved.name === "string")
      p.name = normalizePlayerName(saved.name);
    for (const key of [
      "sound",
      "music",
      "emotesMuted",
      "seenTutorial",
    ] as const)
      if (typeof saved[key] === "boolean") p[key] = saved[key];
    if (
      Array.isArray(saved.decks) &&
      saved.decks.length === 3 &&
      saved.decks.every(validDeck)
    )
      p.decks = saved.decks;
    if (
      Number.isInteger(saved.activeDeck) &&
      saved.activeDeck >= 0 &&
      saved.activeDeck < 3
    )
      p.activeDeck = saved.activeDeck;
    if (validDeck(saved.deck)) p.deck = saved.deck;
    else p.deck = [...p.decks[p.activeDeck]];
    p.chests = Array.isArray(saved.chests)
      ? saved.chests
          .filter(
            (c: unknown) =>
              typeof c === "string" &&
              ["silver", "gold", "magical"].includes(c),
          )
          .slice(0, 4)
      : [];
    p.history = Array.isArray(saved.history)
      ? saved.history
          .map((r: unknown) => migrateLocalRecord(r))
          .filter(validRecordEntry)
          .slice(0, 10)
      : [];
  } catch {
    return null;
  }
  return p;
}

export const MAX_BACKUP_BYTES = 2_000_000;
export function exportProgress(profile: Profile): string {
  return JSON.stringify(
    {
      format: "browser-royale-progress",
      version: 1,
      profile: {
        ...profile,
        history: profile.history.map((record) => ({
          ...record,
          replay: {
            ...record.replay,
            rulesFamily: record.replay.rulesFamily ?? "origin",
          },
        })),
      },
    },
    null,
    2,
  );
}

/** Backups must restore completely; local storage recovery may discard broken fields. */
export function importProgress(text: string): Profile {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error("Choose a progress backup smaller than 2 MB.");
  let saved;
  try {
    saved = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Browser Arena progress backup.");
  }
  if (
    saved?.format !== "browser-royale-progress" ||
    saved.version !== 1 ||
    !saved.profile
  )
    throw new Error(
      "Choose a Browser Arena progress backup exported by this game.",
    );
  if (Array.isArray(saved.profile.history))
    saved.profile.history = saved.profile.history.map((r: unknown) =>
      migrateLocalRecord(r, true),
    );
  const profile = decodeProfile(JSON.stringify(saved.profile));
  if (
    !profile ||
    !Object.keys(profile).every(
      (key) =>
        JSON.stringify(profile[key as keyof Profile]) ===
        JSON.stringify(saved.profile[key]),
    )
  )
    throw new Error(
      "This backup contains incomplete or invalid progress. Your current progress is unchanged.",
    );
  return profile;
}
export let storageAvailable = true;
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}
export function recordBattle(
  p: Profile,
  b: Battle,
  options?: {
    friendly?: boolean;
    practice?: boolean;
    playerName?: string;
    opponent?: string;
    opponentType?: "ai" | "friend";
    matchId?: string;
    replay?: Replay;
  },
): { trophies: number; gold: number; chest: string | null } {
  if (
    !b.winner ||
    (options?.matchId && p.history.some((r) => r.matchId === options.matchId))
  )
    return { trophies: 0, gold: 0, chest: null };
  const win = b.winner === "blue",
    ranked = !options?.friendly && !options?.practice && b.mode !== "training";
  const trophies = ranked
    ? win
      ? 30
      : b.winner === "draw"
        ? 0
        : -Math.min(15, p.trophies)
    : 0;
  const gold = ranked ? (win ? 125 : 25) : 0;
  p.trophies += trophies;
  p.best = Math.max(p.best, p.trophies);
  p.gold += gold;
  p.battles++;
  if (win) p.wins++;
  p.crowns += b.players.blue.crowns;
  let chest: string | null = null;
  if (win && ranked && p.chests.length < 4) {
    chest = p.wins % 5 === 0 ? "magical" : p.wins % 3 === 0 ? "gold" : "silver";
    p.chests.push(chest as "silver" | "gold" | "magical");
  }
  p.history.unshift({
    playerName: normalizePlayerName(options?.playerName ?? p.name),
    id: Date.now(),
    winner: b.winner,
    crowns: [b.players.blue.crowns, b.players.red.crowns],
    mode: b.mode,
    replay: options?.replay ?? b.exportReplay(),
    opponent: options?.opponent,
    opponentType: options?.opponentType,
    ...(options?.practice ? { practice: true as const } : {}),
    matchId: options?.matchId,
    date: new Date().toISOString(),
  });
  p.history = p.history.slice(0, 10);
  saveProfile(p);
  return { trophies, gold, chest };
}
/** Apply a finished result to trusted saved progress while retaining failed session writes. */
export function saveBattleResult(
  p: Profile,
  b: Battle,
  options?: Parameters<typeof recordBattle>[2],
) {
  if (!b.winner) return { trophies: 0, gold: 0, chest: null };
  const playerName = options?.playerName ?? p.name;
  const saved = storageAvailable ? readSavedProfile() : null;
  if (saved) Object.assign(p, saved);
  return recordBattle(p, b, { ...options, playerName });
}
/** Save the requested preference on trusted progress, retaining failed session changes. */
export function saveEmotePreference(p: Profile, muted: boolean) {
  const saved = storageAvailable ? readSavedProfile() : null;
  if (saved) Object.assign(p, saved);
  p.emotesMuted = muted;
  saveProfile(p);
}
/** Refresh an open editor before changing cards; reading never persists a snapshot. */
export function refreshProfileForDeckEdit(
  p: Profile,
): "none" | "progress" | "decks" {
  const saved = storageAvailable ? readSavedProfile() : null;
  if (!saved || JSON.stringify(saved) === JSON.stringify(p)) return "none";
  const decksChanged = (["activeDeck", "deck", "decks"] as const).some(
    (key) => JSON.stringify(saved[key]) !== JSON.stringify(p[key]),
  );
  Object.assign(p, saved);
  return decksChanged ? "decks" : "progress";
}
export function openChest(p: Profile, index: number) {
  const type = p.chests[index];
  if (!type) return null;
  p.chests.splice(index, 1);
  const gold = type === "magical" ? 750 : type === "gold" ? 350 : 150;
  p.gold += gold;
  const card = CARDS[(p.wins * 7 + p.gold) % CARDS.length];
  saveProfile(p);
  return { type, gold, card };
}
