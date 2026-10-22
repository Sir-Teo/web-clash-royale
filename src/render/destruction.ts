import * as T from "three";
import definitions from "./destruction-data.json";
import { makeMaterial } from "./sprites";
import type { EffectLibrary, EffectSprite } from "./effects";

type Emitter = (typeof definitions.emitters)[keyof typeof definitions.emitters];
export interface DebrisPlan {
  emitter: Emitter;
  clip: string;
  delay: number;
  life: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  angle: number;
}
// Cosmetic RNG is separate from Battle's RNG and is stable during replay.
export function destructionPlan(king: boolean, seed: number): DebrisPlan[] {
  let state = seed | 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  const between = (range: number[]) =>
    range[0] + random() * (range[1] - range[0]);
  return definitions.effects[king ? "king" : "tower"].components.flatMap(
    (component) => {
      const emitter =
        definitions.emitters[
          component.emitter as keyof typeof definitions.emitters
        ];
      const duration = between(emitter.emissionLife);
      let delay = 0;
      return Array.from({ length: emitter.count }, (_, i) => {
        const angle = between(emitter.angle),
          radius = between(emitter.radius),
          speed = between(emitter.speed);
        if (i) delay += between(emitter.interval);
        return {
          emitter,
          angle,
          clip: emitter.clips[Math.floor(random() * emitter.clips.length)],
          delay: component.delay + Math.min(duration, delay),
          life: between(emitter.life),
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          vx: Math.cos(angle) * speed,
          vz: Math.sin(angle) * speed,
          vy: between(emitter.verticalSpeed),
        };
      });
    },
  );
}
export function debrisPose(p: DebrisPlan, age: number) {
  const t = Math.max(0, age),
    e = p.emitter;
  // Source inertia has no retained runtime implementation; exponential drag and
  // a ground clamp are reconstruction choices. Analytic motion is frame-rate independent.
  const drag = e.inertia * 4;
  const distance = drag ? (1 - Math.exp(-drag * t)) / drag : t;
  const opacity = Math.min(
    1,
    e.fadeIn ? t / e.fadeIn : 1,
    e.fadeOut ? (p.life - t) / e.fadeOut : 1,
  );
  return {
    x: p.x + p.vx * distance,
    z: p.z + p.vz * distance,
    y: Math.max(0.04, e.height + p.vy * t + (e.gravity * t * t) / 2),
    scale: T.MathUtils.lerp(e.startScale, e.endScale, Math.min(1, t / p.life)),
    opacity: Math.max(0, opacity),
  };
}
interface Debris {
  plan: DebrisPlan;
  origin: T.Vector3;
  start: number;
  sprite: EffectSprite;
}
export class DestructionEffects {
  private particles: Debris[] = [];
  private clock = 0;
  constructor(
    private scene: T.Scene,
    private library: EffectLibrary,
  ) {}
  get count() {
    return this.particles.length;
  }
  get time() {
    return this.clock;
  }
  burst(king: boolean, origin: T.Vector3, seed: number) {
    for (const plan of destructionPlan(king, seed)) {
      if (this.particles.length >= 400) break;
      const sprite = this.library.make(plan.clip);
      if (!sprite) continue;
      // Each particle fades independently, while geometry and textures stay shared.
      sprite.mesh.material = this.library.asset!.textures.map(makeMaterial);
      sprite.mesh.visible = false;
      this.scene.add(sprite.mesh);
      this.particles.push({
        plan,
        sprite,
        origin: origin.clone(),
        start: this.clock + plan.delay,
      });
    }
  }
  update(dt: number, camera: T.Camera) {
    this.clock += Math.max(0, dt);
    this.particles = this.particles.filter((p) => {
      const age = this.clock - p.start;
      if (age >= p.plan.life) {
        this.remove(p);
        return false;
      }
      p.sprite.mesh.visible = age >= 0;
      if (age < 0) return true;
      const pose = debrisPose(p.plan, age),
        mesh = p.sprite.mesh;
      mesh.position.set(
        p.origin.x + pose.x,
        p.origin.y + pose.y,
        p.origin.z + pose.z,
      );
      mesh.quaternion.copy(camera.quaternion);
      if (p.plan.emitter.rotate) mesh.rotateZ(p.plan.angle);
      mesh.scale.setScalar(pose.scale);
      for (const material of mesh.material) material.opacity = pose.opacity;
      this.library.animate(p.sprite, age, p.plan.emitter.loop);
      return true;
    });
  }
  private remove(p: Debris) {
    this.scene.remove(p.sprite.mesh);
    p.sprite.mesh.material.forEach((m) => m.dispose());
  }
  clear() {
    this.particles.forEach((p) => this.remove(p));
    this.particles = [];
    this.clock = 0;
  }
}
