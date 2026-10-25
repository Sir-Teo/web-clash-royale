import * as T from "three";
import { entityProjectileStartHeight, projectileHitHeight } from "../game/engine";
import type { Entity } from "../game/engine";
import type { EffectLibrary, EffectSprite } from "./effects";
import infernoTower from "../game/inferno-tower-data.json" with { type: "json" };

interface BeamActor {
  target: number;
  stage: 0 | 1 | 2;
  beam: EffectSprite;
  muzzle: EffectSprite;
  hit: EffectSprite;
}

const BEAMS = ["inferno_dragon_beam", "inferno_dragon_beam1", "inferno_dragon_beam2"] as const;

/** Original three-stage SWF beam, muzzle and target impact follow the live lock. */
export class NativeInfernoBeams {
  private actors = new Map<number, BeamActor>();

  constructor(private scene: T.Scene, private effects: EffectLibrary) {}

  get state() {
    return [...this.actors.entries()].map(([id, actor]) => ({
      id,
      target: actor.target,
      stage: actor.stage,
      beam: actor.beam.name,
    }));
  }

  update(entities: readonly Entity[], camera: T.Camera) {
    const active = new Set<number>();
    for (const entity of entities) {
      const lock = entity.inferno;
      const tower = entity.card === "inferno-tower";
      if (entity.hp <= 0 || !lock ||
          (entity.card !== "inferno-dragon" && !tower)) continue;
      const target = entities.find((candidate) => candidate.id === lock.target && candidate.hp > 0);
      if (!target) continue;
      let actor = this.actors.get(entity.id);
      if (actor && actor.stage !== lock.stage) {
        this.release(actor);
        this.actors.delete(entity.id);
        actor = undefined;
      }
      if (!actor) {
        const beam = this.effects.make(tower
          ? infernoTower.beamArt[lock.stage] : BEAMS[lock.stage]);
        const muzzle = this.effects.make(tower
          ? infernoTower.muzzleArt[lock.stage]
          : lock.stage === 2 ? "inferno_shoot_st2" : "inferno_shoot");
        const hit = this.effects.make("inferno_hit_lines");
        if (!beam || !muzzle || !hit) continue;
        actor = { target: lock.target, stage: lock.stage, beam, muzzle, hit };
        this.actors.set(entity.id, actor);
        this.scene.add(beam.mesh, muzzle.mesh, hit.mesh);
      }
      active.add(entity.id);
      actor.target = lock.target;
      const source = new T.Vector3(entity.x - 9,
        entityProjectileStartHeight(entity) ??
          (tower ? infernoTower.projectileStartHeight : 2.3), entity.y - 16);
      const destination = new T.Vector3(
        target.x - 9,
        projectileHitHeight(target),
        target.y - 16,
      );
      const projected = destination.clone().sub(source)
        .applyQuaternion(camera.quaternion.clone().invert());
      const angle = Math.atan2(projected.y, projected.x);
      const bounds = (this.effects.asset!.data.clips[actor.beam.name] as unknown as { bounds: number[] }).bounds;
      const scaleX = Math.hypot(projected.x, projected.y) / ((bounds[2] - bounds[0]) / 30);
      const offset = new T.Vector3(
        Math.cos(angle) * -bounds[0] / 30 * scaleX,
        Math.sin(angle) * -bounds[0] / 30 * scaleX,
        0,
      ).applyQuaternion(camera.quaternion);
      actor.beam.mesh.position.copy(source).add(offset);
      actor.beam.mesh.quaternion.copy(camera.quaternion);
      actor.beam.mesh.rotateZ(angle);
      actor.beam.mesh.scale.set(scaleX, 1, 1);
      actor.muzzle.mesh.position.copy(source);
      actor.muzzle.mesh.quaternion.copy(camera.quaternion);
      actor.muzzle.mesh.rotateZ(angle);
      actor.hit.mesh.position.copy(destination);
      actor.hit.mesh.quaternion.copy(camera.quaternion);
      this.effects.animate(actor.beam, lock.elapsed, true);
      this.effects.animate(actor.muzzle, lock.elapsed, true);
      this.effects.animate(actor.hit, lock.elapsed, true);
    }
    for (const [id, actor] of this.actors)
      if (!active.has(id)) {
        this.release(actor);
        this.actors.delete(id);
      }
  }

  clear() {
    for (const actor of this.actors.values()) this.release(actor);
    this.actors.clear();
  }

  private release(actor: BeamActor) {
    this.scene.remove(actor.beam.mesh, actor.muzzle.mesh, actor.hit.mesh);
  }
}
