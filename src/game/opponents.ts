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
      "minion-horde",
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
      "rocket",
      "zap",
      "valkyrie",
    ],
  },
  {
    name: "Musketeer Marshal",
    style: "Three Musketeers",
    deck: [
      "three-musketeers",
      "hog-rider",
      "knight",
      "skeletons",
      "goblins",
      "fireball",
      "zap",
      "tesla",
    ],
  },
  {
    name: "Lava Captain",
    style: "Lava Clone",
    deck: [
      "lava-hound",
      "lumberjack",
      "mega-minion",
      "inferno-dragon",
      "bats",
      "lightning",
      "clone",
      "tombstone",
    ],
  },
  {
    name: "Golem Warden",
    style: "Golem Night Witch",
    deck: [
      "golem",
      "night-witch",
      "baby-dragon",
      "guards",
      "ice-wizard",
      "tornado",
      "elixir-collector",
      "lightning",
    ],
  },
  {
    name: "Siege Engineer",
    style: "X-Bow cycle",
    deck: [
      "x-bow",
      "ice-spirit",
      "archers",
      "ice-golem",
      "knight",
      "fireball",
      "log",
      "minions",
    ],
  },
  {
    name: "Mortar Marshal",
    style: "Mortar Miner",
    deck: [
      "mortar",
      "dart-goblin",
      "miner",
      "barbarians",
      "goblin-gang",
      "log",
      "rocket",
      "spear-goblins",
    ],
  },
  {
    name: "Royal Cannoneer",
    style: "Royal Giant Furnace",
    deck: [
      "royal-giant",
      "fire-spirits",
      "executioner",
      "electro-wizard",
      "bowler",
      "heal",
      "furnace",
      "zap",
    ],
  },
  {
    name: "Ram Captain",
    style: "Battle Ram bridge pressure",
    deck: [
      "battle-ram",
      "dark-prince",
      "bandit",
      "elite-barbarians",
      "musketeer",
      "inferno-tower",
      "poison",
      "zap",
    ],
  },
  {
    name: "Grave Keeper",
    style: "Giant Skeleton Graveyard",
    deck: [
      "giant-skeleton",
      "graveyard",
      "ice-wizard",
      "knight",
      "mega-minion",
      "bomb-tower",
      "tornado",
      "goblins",
    ],
  },
  {
    name: "Village Warden",
    style: "Hut reinforcements",
    deck: [
      "goblin-hut",
      "barbarian-hut",
      "princess",
      "goblin-gang",
      "minions",
      "barbarians",
      "mirror",
      "valkyrie",
    ],
  },
  {
    name: "Barrel Trickster",
    style: "Goblin Barrel pressure",
    deck: [
      "goblin-barrel",
      "princess",
      "miner",
      "goblins",
      "guards",
      "dart-goblin",
      "log",
      "inferno-tower",
    ],
  },
  {
    name: "Spark Commander",
    style: "Giant Sparky",
    deck: [
      "giant",
      "sparky",
      "mega-minion",
      "electro-wizard",
      "bats",
      "zap",
      "fireball",
      "goblin-gang",
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
