import type { Entity } from "./engine";
import { attackReach, minimumAttackDistance } from "./attack-range";
import { acquisitionSight } from "./sight-range";
import source from "./electro-wizard-data.json" with { type: "json" };

/** The native additional-hit scanner; primary lock selection is separate. */
export function electroExtraTarget(
  attacker: Entity,
  primary: Entity,
  entities: readonly Entity[],
): Entity | undefined {
  const rules = source.extraTargetScan;
  const sight = acquisitionSight(attacker);
  let nominee: Entity | undefined;
  let nearest = Infinity;
  for (const candidate of entities) {
    if (
      candidate.id === primary.id ||
      candidate.hp <= 0 ||
      candidate.team === attacker.team ||
      (candidate.deploy <= 0 && candidate.burrow?.phase === "hidden")
    )
      continue;
    const dx = candidate.x - attacker.x,
      dy = candidate.y - attacker.y;
    const squared = dx * dx + dy * dy;
    const extra =
      candidate.kind === "tower"
        ? rules.crownSightExtra
        : candidate.kind === "building"
          ? rules.buildingSightExtra
          : 0;
    const reach = sight + candidate.radius + extra;
    if (squared > reach * reach) continue;
    // Native team directions are converted into the browser's own-side frame.
    const behind = attacker.team === "blue" ? dy : -dy;
    if (rules.sightClip > 0 && behind > Math.max(0, reach - rules.sightClip))
      continue;
    if (
      rules.sightClipSide > 0 &&
      Math.abs(dx) > Math.max(0, reach - rules.sightClipSide)
    )
      continue;
    if (squared < nearest) {
      nearest = squared;
      nominee = candidate;
    }
  }
  // Native ranking chooses one nominee before validating actual attack range.
  // A failed nominee does not cause the scan to try the next candidate.
  if (nominee) {
    const maximum = attackReach(attacker, nominee);
    const minimum = minimumAttackDistance(attacker, nominee);
    if (nearest <= maximum * maximum && nearest >= minimum * minimum)
      return nominee;
  }
  return source.allTargetsHit && primary.hp > 0 ? primary : undefined;
}
