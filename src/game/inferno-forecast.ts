import { COMBAT_STEP } from "./combat";
import type { AreaEffect, Entity, Point } from "./engine";
import { infernoDamage, infernoProfile } from "./inferno";
import type { DamagePacket } from "./projectile-impacts";
import {
  currentAttackAreas,
  projectAreaFrames,
  type WindupHealthEvaluator,
} from "./tornado-pull";
import rage from "./rage-data.json" with { type: "json" };
import iceWizard from "./ice-wizard-data.json" with { type: "json" };

/** Only the current uninterrupted lock, bounded to the two-second defensive
 * horizon. A cancelled beam may reacquire later; that is a new attack. */
export function infernoKingPackets(
  attacker: Entity,
  king: Entity,
  areas: readonly AreaEffect[],
  order: number,
  health: WindupHealthEvaluator,
  proposed?: Point,
): DamagePacket[] {
  const card = attacker.card;
  const lock = attacker.inferno;
  if (
    (card !== "inferno-tower" && card !== "inferno-dragon") ||
    !lock ||
    lock.target !== king.id ||
    attacker.target !== king.id
  )
    return [];
  const clouds = currentAttackAreas(king, areas, proposed);
  const frames = projectAreaFrames(attacker, clouds, 60);
  const statuses = health(
    attacker,
    frames,
    clouds,
    proposed ? clouds.length - 1 : undefined,
  );
  const source = infernoProfile(card);
  let elapsed = lock.elapsed,
    timer = lock.hitTimer,
    shotSlow = 0;
  const packets: DamagePacket[] = [];
  for (const [index, frame] of frames.entries()) {
    const status = statuses[index];
    shotSlow = Math.max(0, shotSlow - COMBAT_STEP);
    if (
      (status && (!status.beforeAlive || status.beforeInterrupt)) ||
      frame.stun > 0 ||
      Math.hypot(frame.position.x - king.x, frame.position.y - king.y) >
        attacker.range + king.radius + attacker.radius * 0.35
    )
      break;
    // Accumulate exactly as Combat does, including stage-boundary rounding.
    elapsed += COMBAT_STEP;
    const stage =
      elapsed >= source.stageDurations[0] + source.stageDurations[1]
        ? 2
        : elapsed >= source.stageDurations[0]
          ? 1
          : 0;
    timer -=
      COMBAT_STEP *
      (frame.boost >= 1e-8 ? rage.hitSpeedMultiplier : 1) *
      (Math.max(frame.slow, shotSlow) >= 1e-8
        ? iceWizard.hitSpeedMultiplier
        : 1);
    if (timer <= 1e-8) {
      timer += attacker.interval;
      packets.push({
        step: index + 1,
        damage: infernoDamage(card, stage),
        phase: 0.75,
        born: 0,
        order,
      });
    }
    // Projectiles update after Combat, so a pulse on this frame still lands.
    if (status && (!status.afterAlive || status.interrupt)) break;
    shotSlow = Math.max(shotSlow, status?.slow ?? 0);
  }
  return packets;
}
