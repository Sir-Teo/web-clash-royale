import type { Entity, Point, Team } from "../game/engine";
import { chargeEffect, movementEffect } from "./destruction";
import type { ChargeEffect, MovementEffect } from "./destruction";
import { chargeProgress, isCharging } from "../game/charge";

export interface MovementBurst {
  actor: number;
  effect: MovementEffect | ChargeEffect;
  origin: Point;
  team: Team;
  seed: number;
  age: number;
}
interface Track extends Point {
  time: number;
  moved: number;
  carried: number;
  step: number;
  charge: number;
  progress: number;
}

// The archive names the footstep art, but not the animation marker cadence.
// Distance-based emission is stable across display refresh rates and peers.
export class NativeMovementEffects {
  private tracks = new Map<number, Track>();
  static readonly stride = 0.75;
  reset() {
    this.tracks.clear();
  }
  consume(
    entities: readonly Entity[],
    seed: number,
    now: number,
  ): MovementBurst[] {
    const bursts: MovementBurst[] = [];
    const live = new Set<number>();
    for (const entity of entities) {
      const effect = movementEffect(entity.card);
      if (!effect || entity.hp <= 0) continue;
      live.add(entity.id);
      const previous = this.tracks.get(entity.id);
      if (!previous) {
        this.tracks.set(entity.id, {
          x: entity.x,
          y: entity.y,
          time: now,
          moved: entity.move,
          carried: 0,
          step: 0,
          charge: 0,
          progress: chargeProgress(entity),
        });
        continue;
      }
      const dx = entity.x - previous.x,
        dy = entity.y - previous.y,
        distance = Math.hypot(dx, dy),
        elapsed = now - previous.time;
      // Render loops commonly draw several identical frames between match
      // ticks. Those frames must not erase the unspent travel distance.
      if (elapsed === 0 && distance < 1e-8) continue;
      const validTravel =
        entity.deploy <= 0 &&
        entity.move > previous.moved &&
        elapsed > 0 &&
        elapsed <= 1 &&
        distance > 0 &&
        distance <= 2.5;
      const chargeTravel =
        entity.deploy <= 0 &&
        entity.move > previous.moved &&
        elapsed > 0 &&
        elapsed <= 4 &&
        distance > 0 &&
        distance <= Math.max(2.5, elapsed * 4);
      // Progress is normalized across current distance and historical timers.
      // A coalesced peer frame interpolates the cue along the movement path.
      const progress = chargeProgress(entity);
      if (
        chargeTravel &&
        (previous.progress < 1 ||
          (entity.chargeDistance === undefined && previous.progress === 1)) &&
        isCharging(entity)
      ) {
        const charge = chargeEffect(entity.card);
        if (charge) {
          const fraction = Math.min(
            1,
            (1 - previous.progress) / (progress - previous.progress),
          );
          previous.charge++;
          bursts.push({
            actor: entity.id,
            effect: charge,
            origin: {
              x: previous.x + dx * fraction,
              y: previous.y + dy * fraction,
            },
            team: entity.team,
            seed: seed ^ entity.id ^ Math.imul(previous.charge, 0x7f4a7c15),
            age: elapsed * (1 - fraction),
          });
        }
      }
      if (!validTravel) {
        previous.carried = 0;
      } else if (distance > 0) {
        const total = previous.carried + distance;
        const steps = Math.min(
          8,
          Math.floor((total + 1e-8) / NativeMovementEffects.stride),
        );
        for (let i = 1; i <= steps; i++) {
          const fraction = Math.min(
            1,
            (i * NativeMovementEffects.stride - previous.carried) / distance,
          );
          previous.step++;
          bursts.push({
            actor: entity.id,
            effect,
            origin: {
              x: previous.x + dx * fraction,
              y: previous.y + dy * fraction,
            },
            team: entity.team,
            seed: seed ^ entity.id ^ Math.imul(previous.step, 0x9e3779b9),
            age: elapsed * (1 - fraction),
          });
        }
        previous.carried = total % NativeMovementEffects.stride;
      }
      previous.x = entity.x;
      previous.y = entity.y;
      previous.time = now;
      previous.moved = entity.move;
      previous.progress = progress;
    }
    for (const id of this.tracks.keys())
      if (!live.has(id)) this.tracks.delete(id);
    return bursts;
  }
}
