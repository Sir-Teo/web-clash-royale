import type { Entity, Point, Team } from "../game/engine";
import { landingEffect } from "./destruction";
import type { LandingEffect } from "./destruction";

const NORTH_BANK = 14.8;
const SOUTH_BANK = 17.2;
const RIVER_WIDTH = SOUTH_BANK - NORTH_BANK;
// JumpHeight=4000 is retained in the logic table; this browser's visual
// world scale uses a smaller arc to clear its reconstructed river surface.
const JUMP_HEIGHT = 2.2;

export function hogJumpHeight(
  entity: Pick<Entity, "card" | "team" | "y" | "hp" | "deploy">,
): number {
  if (entity.card !== "hog-rider" || entity.hp <= 0 || entity.deploy > 0)
    return 0;
  const progress =
    entity.team === "blue"
      ? (SOUTH_BANK - entity.y) / RIVER_WIDTH
      : (entity.y - NORTH_BANK) / RIVER_WIDTH;
  return progress > 0 && progress < 1
    ? JUMP_HEIGHT * Math.sin(Math.PI * progress)
    : 0;
}

export interface HogLandingBurst {
  effect: LandingEffect;
  origin: Point;
  team: Team;
  seed: number;
  age: number;
}
interface Track extends Point {
  time: number;
  moved: number;
  landings: number;
}

export class NativeHogLandings {
  private tracks = new Map<number, Track>();
  reset() {
    this.tracks.clear();
  }
  consume(
    entities: readonly Entity[],
    seed: number,
    now: number,
  ): HogLandingBurst[] {
    const bursts: HogLandingBurst[] = [];
    const live = new Set<number>();
    for (const entity of entities) {
      const effect = landingEffect(entity.card);
      if (!effect || entity.hp <= 0) continue;
      live.add(entity.id);
      const previous = this.tracks.get(entity.id);
      if (!previous) {
        this.tracks.set(entity.id, {
          x: entity.x,
          y: entity.y,
          time: now,
          moved: entity.move,
          landings: 0,
        });
        continue;
      }
      const distance = Math.hypot(entity.x - previous.x, entity.y - previous.y);
      const elapsed = now - previous.time;
      const bank = entity.team === "blue" ? NORTH_BANK : SOUTH_BANK;
      const crossed =
        entity.team === "blue"
          ? previous.y > bank && entity.y <= bank
          : previous.y < bank && entity.y >= bank;
      if (
        crossed &&
        entity.move > previous.moved &&
        entity.deploy <= 0 &&
        elapsed > 0 &&
        elapsed <= 1 &&
        distance <= 2.5
      ) {
        const fraction = (bank - previous.y) / (entity.y - previous.y);
        previous.landings++;
        bursts.push({
          effect,
          origin: {
            x: previous.x + (entity.x - previous.x) * fraction,
            y: bank,
          },
          team: entity.team,
          seed: seed ^ entity.id ^ Math.imul(previous.landings, 0x9e3779b9),
          age: elapsed * (1 - fraction),
        });
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
