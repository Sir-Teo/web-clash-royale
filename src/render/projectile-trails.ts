import type { Projectile } from "../game/engine";

export interface TrailBurst {
  projectile: Projectile;
  seed: number;
  start: number;
  age: number;
}
/** Repeat the retained 800-ms emitter envelope along a fixed flight path.
 * Cursors use simulation age, so pause, late snapshots and frame rate agree.
 */
export class NativeProjectileTrails {
  private next = new Map<number, number>();
  reset() {
    this.next.clear();
  }
  consume(projectiles: readonly Projectile[], seed: number): TrailBurst[] {
    const bursts: TrailBurst[] = [];
    const alive = new Set(projectiles.map((p) => p.id));
    for (const id of this.next.keys()) if (!alive.has(id)) this.next.delete(id);
    for (const p of projectiles) {
      if (p.style !== "rocket" || !p.flight || (p.delay ?? 0) > 1e-8) continue;
      const elapsed = p.elapsed ?? 0;
      // The longest retained smoke lifetime is two seconds. Skip expired cycles
      // when a guest first receives an in-flight Rocket.
      let cycle =
        this.next.get(p.id) ?? Math.max(0, Math.floor((elapsed - 3) / 0.8));
      while (cycle * 0.8 <= elapsed + 1e-8 && cycle * 0.8 < p.duration) {
        bursts.push({
          projectile: p,
          seed: seed ^ p.id ^ Math.imul(cycle + 1, 0x9e3779b9),
          start: cycle * 0.8,
          age: elapsed - cycle * 0.8,
        });
        cycle++;
      }
      this.next.set(p.id, cycle);
    }
    return bursts;
  }
}
