import { CARD_MAP } from "./cards";
import { nativeCrownAmount } from "./crown-damage";
import type { Entity } from "./engine";
import poison from "./poison-data.json" with { type: "json" };

/** The victim's policy keeps live ticks and every forecast on its host rules. */
export function poisonTickDamage(
  target: Pick<Entity, "kind" | "nativeBuffCrownDamage">,
) {
  const damage = CARD_MAP.poison.damage;
  if (target.kind !== "tower") return damage;
  return target.nativeBuffCrownDamage
    ? nativeCrownAmount(damage, poison.crownTowerDamagePercent)
    : damage * poison.crownTowerDamageFraction;
}
