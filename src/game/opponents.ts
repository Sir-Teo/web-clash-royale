import type { CardId } from "./cards";
import type { Mode } from "./engine";
import type { RecordEntry } from "./profile";

interface SoloOpponent {
  readonly name: string;
  readonly style: string;
  readonly deck: readonly CardId[];
}

/** Curated, legal decks with a win condition, air defense and affordable support. */
export const SOLO_OPPONENTS = [
  {
    name: "Royal Trainer",
    style: "Giant push",
    deck: [
      "giant",
      "archers",
      "knight",
      "bomber",
      "minions",
      "fireball",
      "mini-pekka",
      "arrows",
    ],
  },
  {
    name: "Hog Trainer",
    style: "Hog cycle",
    deck: [
      "hog-rider",
      "musketeer",
      "cannon",
      "skeletons",
      "goblins",
      "fireball",
      "zap",
      "valkyrie",
    ],
  },
  {
    name: "Sky Captain",
    style: "Balloon Freeze",
    deck: [
      "balloon",
      "baby-dragon",
      "minions",
      "freeze",
      "knight",
      "archers",
      "arrows",
      "tesla",
    ],
  },
  {
    name: "Witch Warden",
    style: "Witch Poison",
    deck: [
      "giant",
      "witch",
      "spear-goblins",
      "skeleton-army",
      "poison",
      "cannon",
      "musketeer",
      "zap",
    ],
  },
  {
    name: "Prince Captain",
    style: "Prince Rage",
    deck: [
      "prince",
      "rage",
      "giant",
      "bomber",
      "archers",
      "goblins",
      "arrows",
      "mini-pekka",
    ],
  },
  {
    name: "Iron Guardian",
    style: "P.E.K.K.A defense",
    deck: [
      "pekka",
      "wizard",
      "tesla",
      "skeletons",
      "spear-goblins",
      "fireball",
      "zap",
      "valkyrie",
    ],
  },
] as const satisfies readonly SoloOpponent[];

export function previousSoloOpponent(
  history: readonly Pick<
    RecordEntry,
    "opponent" | "opponentType" | "matchId"
  >[],
) {
  const record = history.find(
    (record) =>
      record.opponentType === "ai" ||
      (!record.opponentType && !record.opponent && !record.matchId),
  );
  // Solo records from before named opponents used the original Royal Trainer.
  return record ? (record.opponent ?? SOLO_OPPONENTS[0].name) : undefined;
}

/** Select outside Battle's RNG; recorded enemyDeck is sufficient for replay. */
export function soloOpponent(seed: number, mode: Mode, previousName?: string) {
  const pool =
    mode === "training"
      ? [SOLO_OPPONENTS[0]]
      : SOLO_OPPONENTS.filter((opponent) => opponent.name !== previousName);
  let hash = seed >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash ^= hash >>> 16;
  const opponent = pool[(hash >>> 0) % pool.length];
  return { ...opponent, deck: [...opponent.deck] as CardId[] };
}
