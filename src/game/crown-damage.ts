import type { Entity } from "./engine";
import cards from "./crown-damage-data.json" with { type: "json" };
import areas from "./area-crown-damage-data.json" with { type: "json" };

/** Native helper for nonnegative integer damage and a signed percent modifier. */
export const nativeCrownAmount = (damage: number, percent: number) =>
  Math.ceil((damage * Math.max(0, 100 + percent)) / 100);

/** The victim carries the authoritative rule through forecasts and snapshots. */
export function projectileCrownDamage(
  style: string,
  target: Pick<
    Entity,
    "kind" | "nativeProjectileCrownDamage" | "nativeAreaCrownDamage"
  >,
  damage: number,
  legacyFraction: number,
) {
  if (target.kind !== "tower") return damage;
  const area = areas[style as keyof typeof areas];
  if (target.nativeAreaCrownDamage && area)
    return nativeCrownAmount(damage, area.percent);
  const source = cards[style as keyof typeof cards];
  return target.nativeProjectileCrownDamage && source
    ? nativeCrownAmount(damage, source.percent)
    : damage * legacyFraction;
}
