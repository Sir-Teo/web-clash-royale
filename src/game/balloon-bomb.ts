import source from "./balloon-bomb-data.json" with { type: "json" };

const current = {
  damage: Math.round(source.bomb.sourceDamage * 1.1 ** 5),
  delay: source.bomb.delay,
  radius: source.bomb.radius,
  air: source.bomb.hitsAir,
} as const;
const legacy = { damage: 240, delay: 0.8, radius: 2.2, air: false } as const;

/** Rules 20 recover the archived bomb. Earlier origin recordings retain the
 * original damage, flight duration, radius and ground-only collision mask. */
export const balloonBombProfile = (rulesVersion = 20) =>
  rulesVersion >= 20 ? current : legacy;
