import type { Entity } from "./engine";
import source from "./sparky-preload-data.json" with { type: "json" };
/** Native passive reload uses real time; an in-range target uses the active clock. */
export function sparkyLoadRate(
  body: Pick<Entity, "nativeSparkyPreload">,
  inRangeTarget: boolean,
  activeRate: number,
): number {
  return body.nativeSparkyPreload && !inRangeTarget
    ? source.passiveRate
    : activeRate;
}
