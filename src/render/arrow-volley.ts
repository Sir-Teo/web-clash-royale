import type { Team } from "../game/engine";

// The retained Arrows card requests 15 projectiles, with damage on the first.
// Earlier replays split the artwork across three damage waves.
// Their exact original random scatter is untraced, so use a deterministic
// sunflower across the archived four-tile radius. The same positions drive
// flight artwork and ground hits; the guest's rotated team flips both axes.
export function arrowOffsets(
  projectileId: number,
  staggered: boolean,
  team: Team,
) {
  const count = staggered ? 5 : 15;
  const first = staggered ? (((projectileId % 3) + 3) % 3) * 5 : 0;
  const sign = team === "red" ? -1 : 1;
  return Array.from({ length: count }, (_, i) => {
    const slot = first + i;
    const angle = slot * 2.399963229728653;
    const radius = 4 * Math.sqrt((slot + 0.5) / 15);
    return {
      x: sign * Math.cos(angle) * radius,
      y: sign * Math.sin(angle) * radius,
    };
  });
}
