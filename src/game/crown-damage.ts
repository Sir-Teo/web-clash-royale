import type { Entity } from "./engine";
import cards from "./crown-damage-data.json" with { type: "json" };

/** Native helper for nonnegative integer damage and a signed percent modifier. */
export const nativeCrownAmount = (damage: number, percent: number) =>
  Math.ceil((damage * Math.max(0, 100 + percent)) / 100);

/** The victim carries the authoritative rule through forecasts and snapshots. */
export function projectileCrownDamage(
  style: string,
  target: Pick<Entity, "kind" | "nativeProjectileCrownDamage">,
  damage: number,
  legacyFraction: number,
) {
  if (target.kind !== "tower") return damage;
  const source = cards[style as keyof typeof cards];
  return target.nativeProjectileCrownDamage && source
    ? nativeCrownAmount(damage, source.percent)
    : damage * legacyFraction;
}
