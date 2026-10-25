import * as T from "three";
import type { Projectile } from "../game/engine";
import type { EffectLibrary, EffectSprite } from "./effects";

/** Keep the archived digging trail attached to Miner's moving underground path. */
export class NativeMinerTrails {
  private trails = new Map<number, EffectSprite>();

  constructor(private scene: T.Scene, private effects: EffectLibrary) {}

  get state() {
    return [...this.trails.keys()];
  }

  update(projectiles: readonly Projectile[], camera: T.Camera) {
    const active = new Set<number>();
    for (const projectile of projectiles) {
      if (projectile.style !== "miner-travel" || !projectile.flight) continue;
      let sprite = this.trails.get(projectile.id);
      if (!sprite) {
        sprite = this.effects.make("miner_trail") ?? undefined;
        if (!sprite) continue;
        this.trails.set(projectile.id, sprite);
        this.scene.add(sprite.mesh);
      }
      active.add(projectile.id);
      sprite.mesh.position.set(projectile.flight.x - 9, 0.25, projectile.flight.y - 16);
      sprite.mesh.quaternion.copy(camera.quaternion);
      this.effects.animate(sprite, projectile.elapsed ?? 0, true);
    }
    for (const [id, sprite] of this.trails)
      if (!active.has(id)) {
        this.scene.remove(sprite.mesh);
        this.trails.delete(id);
      }
  }

  clear() {
    for (const sprite of this.trails.values()) this.scene.remove(sprite.mesh);
    this.trails.clear();
  }
}
