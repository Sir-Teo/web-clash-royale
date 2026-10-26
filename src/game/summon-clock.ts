import profiles from "./summon-clock-data.json" with { type: "json" };

export type SummonerCard = keyof typeof profiles;
export type SummonProfile = (typeof profiles)[SummonerCard];
export const summonProfile = (card: string): SummonProfile | undefined =>
  Object.hasOwn(profiles, card) ? profiles[card as SummonerCard] : undefined;

export interface SummonClock {
  spawnTimer: number;
  spawnIndex?: number;
}

/** One eligible update: native interval/pause selection and carried remainder.
 * A serial wave emits at most one child per update; zero spacing emits a group. */
export function advanceSummonClock(
  clock: SummonClock,
  profile: SummonProfile,
  delta: number,
) {
  clock.spawnTimer -= delta;
  if (clock.spawnTimer > 1e-8) return;
  const index = clock.spawnIndex ?? 0;
  const count = profile.interval > 0 ? 1 : profile.count;
  clock.spawnIndex =
    profile.interval > 0 && index + 1 < profile.count ? index + 1 : 0;
  clock.spawnTimer = Math.max(
    0.001,
    clock.spawnTimer + (clock.spawnIndex ? profile.interval : profile.pause),
  );
  return { index, count, startsWave: index === 0 };
}

export const summonCycle = (profile: SummonProfile) =>
  profile.pause + Math.max(0, profile.count - 1) * profile.interval;
