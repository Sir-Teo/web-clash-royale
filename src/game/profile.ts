import { CARDS, CARD_MAP, STARTER_DECK } from "./cards";
import type { CardId } from "./cards";
import type { Battle, Mode, Replay } from "./engine";
export interface RecordEntry {
  opponent?: string;
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
const KEY = "browser-royale.profile.v1";
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
  a.every((v) => typeof v === "string" && v in CARD_MAP);
export function loadProfile(): Profile {
  const p = base();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return p;
    const saved = JSON.parse(raw);
    if (saved.version !== 1) return p;
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
      p.name = saved.name.trim().slice(0, 18) || p.name;
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
          .filter((c: unknown) =>
            ["silver", "gold", "magical"].includes(String(c)),
          )
          .slice(0, 4)
      : [];
    p.history = Array.isArray(saved.history)
      ? saved.history
          .filter(
            (r: RecordEntry) =>
              r &&
              Number.isFinite(r.id) &&
              (r.opponent === undefined || typeof r.opponent === "string") &&
              (r.matchId === undefined || typeof r.matchId === "string") &&
              (r.replay?.perspective === undefined ||
                ["blue", "red"].includes(r.replay.perspective)) &&
              ["blue", "red", "draw"].includes(r.winner) &&
              Array.isArray(r.crowns) &&
              r.crowns.length === 2 &&
              r.crowns.every(Number.isFinite) &&
              [1, 2, 3, 4, 5, 6, 7].includes(r.replay?.version) &&
              Number.isInteger(r.replay.duration) &&
              r.replay.duration >= 0 &&
              r.replay.duration <= 9000 &&
              validDeck(r.replay.deck) &&
              validDeck(r.replay.enemyDeck) &&
              Array.isArray(r.replay.actions) &&
              r.replay.actions.length <= 2000 &&
              r.replay.actions.every(
                (a) =>
                  a &&
                  Number.isInteger(a.tick) &&
                  a.tick >= 0 &&
                  ["blue", "red"].includes(a.team) &&
                  a.card in CARD_MAP &&
                  Number.isFinite(a.x) &&
                  Number.isFinite(a.y),
              ),
          )
          .slice(0, 10)
      : [];
  } catch {
    /* Corrupt or unavailable browser storage falls back to a fresh local profile. */
  }
  return p;
}
export let storageAvailable = true;
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
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
    opponent?: string;
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
    ranked = !options?.friendly && b.mode !== "training";
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
    id: Date.now(),
    winner: b.winner,
    crowns: [b.players.blue.crowns, b.players.red.crowns],
    mode: b.mode,
    replay: options?.replay ?? b.exportReplay(),
    opponent: options?.opponent,
    matchId: options?.matchId,
    date: new Date().toISOString(),
  });
  p.history = p.history.slice(0, 10);
  saveProfile(p);
  return { trophies, gold, chest };
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
