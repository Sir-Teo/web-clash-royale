import { SOLO_OPPONENTS } from "../game/opponents";
import type { PracticeOpponent } from "../game/match-decks";

/** One captured UTC day selects a reproducible curated matchup and opening. */
export function dailyPractice(date = new Date()): {
  day: string;
  playerStyle: string;
  opponentStyle: string;
  practice: PracticeOpponent;
} {
  const day = date.toISOString().slice(0, 10);
  let hash = 2166136261;
  for (const char of day)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const seed = hash & 0x7fffffff || 1;
  const count = SOLO_OPPONENTS.length;
  const playerIndex = seed % count;
  const opponentIndex =
    (playerIndex + 1 + (Math.floor(seed / count) % (count - 1))) % count;
  const player = SOLO_OPPONENTS[playerIndex];
  const opponent = SOLO_OPPONENTS[opponentIndex];
  return {
    day,
    playerStyle: player.style,
    opponentStyle: opponent.style,
    practice: {
      name: `${opponent.name} · ${day}`,
      style: "Daily practice",
      mode: "classic",
      deck: [...opponent.deck],
      playerDeck: [...player.deck],
      openingSeed: seed,
      selection: { playerChoice: `curated:${playerIndex}`, opponentIndex },
    },
  };
}
