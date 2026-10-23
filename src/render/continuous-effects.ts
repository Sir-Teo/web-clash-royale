import type { Entity, Point, Team } from "../game/engine";
import golem from "../game/golem-data.json" with { type: "json" };
import definitions from "./destruction-data.json";
import { continuousEffect } from "./destruction";
import type { ContinuousEffect } from "./destruction";

export interface ContinuousBurst {
  actor: number;
  effect: ContinuousEffect;
  component: number;
  origin: Point;
  team: Team;
  seed: number;
  age: number;
}
interface Track extends Point { activeAge: number }

// The authored Golem effect repeats four particle emissions. Follow the actor
// instead of anchoring its delayed particles at the original deploy position.
export class NativeContinuousEffects {
  private tracks = new Map<number, Track>();
  reset() { this.tracks.clear(); }
  consume(entities: readonly Entity[], seed: number): ContinuousBurst[] {
    const bursts: ContinuousBurst[] = [];
    const live = new Set<number>();
    for (const entity of entities) {
      const effect = continuousEffect(entity.card);
      if (!effect || entity.hp <= 0 || entity.deploy > 1e-8) continue;
      live.add(entity.id);
      const definition = definitions.continuities[entity.card as "golem"];
      const activeAge = Math.max(0, entity.age - golem.golem.sourceDeployTime);
      const previous = this.tracks.get(entity.id);
      // At a late peer snapshot, reconstruct only particles whose native life
      // can still overlap the current frame. Earlier positions are unknown.
      const lower = previous
        ? Math.max(previous.activeAge, activeAge - 7)
        : Math.max(-1e-6, activeAge - 7);
      const startCycle = Math.max(0, Math.floor(lower / definition.cycle));
      const endCycle = Math.floor(activeAge / definition.cycle);
      for (let cycle = startCycle; cycle <= endCycle; cycle++)
        for (const [component, item] of definition.components.entries()) {
          const emission = cycle * definition.cycle + item.delay;
          if (emission <= lower + 1e-8 || emission > activeAge + 1e-8) continue;
          const fraction = previous && activeAge > previous.activeAge
            ? Math.max(0, Math.min(1,
              (emission - previous.activeAge) / (activeAge - previous.activeAge)))
            : 1;
          bursts.push({
            actor: entity.id,
            effect,
            component,
            origin: {
              x: previous ? previous.x + (entity.x - previous.x) * fraction : entity.x,
              y: previous ? previous.y + (entity.y - previous.y) * fraction : entity.y,
            },
            team: entity.team,
            seed: seed ^ entity.id ^ Math.imul(cycle + 1, 0x9e3779b9),
            age: Math.max(0, activeAge - emission),
          });
        }
      this.tracks.set(entity.id, { x: entity.x, y: entity.y, activeAge });
    }
    for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id);
    return bursts;
  }
}
