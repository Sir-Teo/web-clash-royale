import type { Entity } from "./engine";
import { combatTraits } from "./combat";
import source from "./target-loss-data.json" with { type: "json" };
export type TargetLossMode = "point" | "self";
/** Eligibility is bound to source self-center/primary-Homing and native requests. */
export function targetLossMode(
  body: Pick<Entity, "card" | "king">,
): TargetLossMode | undefined {
  return (source.modes as Readonly<Record<string, TargetLossMode>>)[
    combatTraits(body).source
  ];
}
