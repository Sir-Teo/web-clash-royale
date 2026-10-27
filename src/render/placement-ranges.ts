import { CARD_MAP, type CardId } from "../game/cards";
import { deploymentRadius } from "../game/deployment";
import {
  attackReach,
  minimumAttackDistance,
  NATIVE_RANGE_RADIUS_FACTOR,
} from "../game/attack-range";
import mortar from "../game/mortar-data.json" with { type: "json" };

/** A target's body may overlap the building's outer/inner boundary. */
export function placementRanges(id: CardId, version: number) {
  const card = CARD_MAP[id];
  let outer = card.radius ?? (card.kind === "building" ? card.range : 0.8);
  let inner = id === "mortar" ? mortar.minimumRange : 0;
  if (card.kind === "building") {
    const body = {
      range: card.range,
      radius: deploymentRadius(id),
      rangeRadiusFactor: NATIVE_RANGE_RADIUS_FACTOR,
      minimumRange: inner,
    };
    if (version >= 24 && card.radius === undefined && card.range > 0)
      outer = attackReach(body, { radius: 0 });
    if (version >= 26 && inner > 0)
      inner = minimumAttackDistance(body, { radius: 0 });
  }
  return { outer, inner };
}
