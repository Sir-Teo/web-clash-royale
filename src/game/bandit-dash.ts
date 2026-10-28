import type { Entity } from "./engine";
import bandit from "./bandit-data.json" with { type: "json" };

/** Host entity policy preserves historical travel through guest snapshots. */
export function banditDashSpeed(entity: Pick<Entity, "nativeBanditDash">) {
  return entity.nativeBanditDash ? bandit.dash.speed : bandit.dash.legacySpeed;
}
