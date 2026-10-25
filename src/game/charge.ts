import type { Entity } from "./engine";
import darkPrince from "./dark-prince-data.json" with { type: "json" };
import battleRam from "./battle-ram-data.json" with { type: "json" };

type Charger = Pick<Entity, "card" | "move" | "chargeDistance">;
const legacyRange = (card: Entity["card"]) =>
  card === "prince" ? 2.3 : chargeRange(card);

/** ChargeRange is hundredths of a tile; verified in charge-native-trace.json. */
export function chargeRange(card: Entity["card"]): number {
  return card === "prince"
    ? 2.5
    : card === "dark-prince"
      ? darkPrince.chargeRange
      : card === "battle-ram"
        ? battleRam.chargeRange
        : Infinity;
}

export function chargeProgress(e: Charger): number {
  return e.chargeDistance === undefined
    ? e.move / legacyRange(e.card)
    : e.chargeDistance / chargeRange(e.card);
}

/** Older recordings used a strict timer comparison for movement and artwork. */
export function isCharging(e: Charger): boolean {
  return e.chargeDistance === undefined
    ? e.move > legacyRange(e.card)
    : e.chargeDistance >= chargeRange(e.card);
}

export function chargeSpeedMultiplier(e: Charger): number {
  if (!isCharging(e)) return 1;
  return e.card === "prince"
    ? e.chargeDistance === undefined
      ? 1.8
      : 2
    : e.card === "dark-prince"
      ? darkPrince.chargeSpeedMultiplier
      : battleRam.chargeSpeedMultiplier;
}

export function chargedAttackDamage(
  e: Charger & Pick<Entity, "damage">,
): number {
  // Historical attack damage used >= even when the visual timer used >.
  const ready =
    e.chargeDistance === undefined
      ? e.move >= legacyRange(e.card)
      : e.chargeDistance >= chargeRange(e.card);
  if (!ready) return e.damage;
  return e.card === "battle-ram"
    ? Math.round((battleRam.sourceChargeDamage * 218) / 100)
    : e.card === "dark-prince"
      ? Math.round(darkPrince.sourceChargeDamage * 1.1 ** 5)
      : e.card === "prince"
        ? e.damage * 2
        : e.damage;
}

export function resetMovement(e: Pick<Entity, "move" | "chargeDistance">) {
  e.move = 0;
  if (e.chargeDistance !== undefined) e.chargeDistance = 0;
}
