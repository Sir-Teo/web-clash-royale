import type { Entity, Point } from "./engine";
import bandit from "./bandit-data.json" with { type: "json" };

/** Native initial and pending windows use the target's virtual radius. */
export function banditChargeInRange(
  actor: Point & Pick<Entity, "radius">,
  target: Point & Pick<Entity, "radius" | "dash">,
  pending = false,
) {
  const scale = bandit.dash.goal.unitsPerTile;
  const radius = target.dash ? 0 : Math.round(target.radius * scale);
  const lower = pending ? 0 : Math.max(0,
    Math.round(bandit.dash.minimum * scale) + Math.round(actor.radius * scale) - radius);
  const upper = Math.round(bandit.dash.maximum * scale) + radius +
    (pending ? bandit.dash.startup.retentionExtensionUnits : 0);
  const dx = Math.round(actor.x * scale) - Math.round(target.x * scale),
    dy = Math.round(actor.y * scale) - Math.round(target.y * scale);
  return dx * dx + dy * dy >= lower * lower && dx * dx + dy * dy <= upper * upper;
}
