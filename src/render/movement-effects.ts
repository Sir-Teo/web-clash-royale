import type { Entity, Point, Team } from "../game/engine";
import { chargeEffect, movementEffect } from "./destruction";
import type { ChargeEffect, MovementEffect } from "./destruction";

export interface MovementBurst {
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
      // Charge animation begins when the browser's source-backed Prince
      // movement timer passes 2.3 s. A coalesced peer frame interpolates the
      // threshold along the travel path, just like footsteps.
      if (
        validTravel &&
        entity.card === "prince" &&
        previous.moved <= 2.3 &&
        entity.move > 2.3
      ) {
        const charge = chargeEffect(entity.card);
        if (charge) {
          const fraction = Math.min(
            1,
            (2.3 - previous.moved) / (entity.move - previous.moved),
          );
          previous.charge++;
          bursts.push({
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
    }
    for (const id of this.tracks.keys())
      if (!live.has(id)) this.tracks.delete(id);
    return bursts;
  }
}
