import * as T from "three";
import definitions from "./destruction-data.json";
import { makeMaterial, effectMaterials, spriteGeometry } from "./sprites";
import type { EffectLibrary } from "./effects";
import type { Team } from "../game/engine";
import { particleTailPose, rotatedSpriteHeight } from "./particle-tail";

type Emitter = (typeof definitions.emitters)[keyof typeof definitions.emitters];
export type DeathEffect = keyof typeof definitions.effects;
export type ImpactEffect = keyof typeof definitions.impacts;
export type TrailEffect = `trail:${keyof typeof definitions.trails}`;
export type LaunchEffect = `launch:${keyof typeof definitions.launches}`;
export type MovementEffect = `move:${keyof typeof definitions.movements}`;
export type ChargeEffect = `charge:${keyof typeof definitions.charges}`;
export type LandingEffect = `land:${keyof typeof definitions.landings}`;
type DeploymentCard = keyof typeof definitions.deployments;
export type DeploymentEffect = `deploy:${DeploymentCard}`;
type NativeEffect =
  | DeathEffect
  | ImpactEffect
  | TrailEffect
  | LaunchEffect
  | MovementEffect
  | ChargeEffect
  | LandingEffect
  | DeploymentEffect;
const compositions = { ...definitions.effects, ...definitions.impacts };
// Two native Zaps plus a full Skeleton Army swarm schedule 1,028 particles.
// Keep the cap bounded while retaining every authored fragment in that scene.
const MAX_NATIVE_PARTICLES = 1280;
export function deploymentEffect(card: string): DeploymentEffect | undefined {
  return Object.hasOwn(definitions.deployments, card)
    ? `deploy:${card as DeploymentCard}`
    : undefined;
}
export function impactEffect(card: string): ImpactEffect | undefined {
  const key = Object.hasOwn(definitions.impacts, card) ? card : `hit:${card}`;
  return Object.hasOwn(definitions.impacts, key)
    ? (key as ImpactEffect)
    : undefined;
}
export function launchEffect(card: string): LaunchEffect | undefined {
  return Object.hasOwn(definitions.launches, card)
    ? `launch:${card as keyof typeof definitions.launches}`
    : undefined;
}
export function movementEffect(card: string): MovementEffect | undefined {
  return Object.hasOwn(definitions.movements, card)
    ? `move:${card as keyof typeof definitions.movements}`
    : undefined;
}
export function chargeEffect(card: string): ChargeEffect | undefined {
  return Object.hasOwn(definitions.charges, card)
    ? `charge:${card as keyof typeof definitions.charges}`
    : undefined;
}
export function landingEffect(card: string): LandingEffect | undefined {
  return Object.hasOwn(definitions.landings, card)
    ? `land:${card as keyof typeof definitions.landings}`
    : undefined;
}
export function deathEffect(
  card: string,
  king = false,
): DeathEffect | undefined {
  const key = card === "tower" ? (king ? "king" : "tower") : card;
  return key in definitions.effects ? (key as DeathEffect) : undefined;
}
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
  tailDelay: number;
  angle: number;
  ground: boolean;
  layer: string;
  scale: number;
}
// Cosmetic RNG is separate from Battle's RNG and is stable during replay.
export function destructionPlan(
  effect: NativeEffect,
  seed: number,
  team: Team = "blue",
): DebrisPlan[] {
  let state = seed | 0;
  // A separate cosmetic stream preserves existing clip, lifetime and motion
  // choices when adding source tails. Neither stream touches the combat RNG.
  let tailState = (seed ^ 0x5bd1e995) | 0;
  const tailRandom = () => {
    tailState = (Math.imul(tailState, 1664525) + 1013904223) | 0;
    return (tailState >>> 0) / 4294967296;
  };
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  const between = (range: number[]) =>
    range[0] + random() * (range[1] - range[0]);
  const definition = effect.startsWith("trail:")
    ? definitions.trails[effect.slice(6) as keyof typeof definitions.trails]
    : effect.startsWith("deploy:")
      ? definitions.deployments[effect.slice(7) as DeploymentCard]
      : effect.startsWith("launch:")
        ? definitions.launches[
            effect.slice(7) as keyof typeof definitions.launches
          ]
        : effect.startsWith("move:")
          ? definitions.movements[
              effect.slice(5) as keyof typeof definitions.movements
            ]
          : effect.startsWith("charge:")
            ? definitions.charges[
                effect.slice(7) as keyof typeof definitions.charges
              ]
            : effect.startsWith("land:")
              ? definitions.landings[
                  effect.slice(5) as keyof typeof definitions.landings
                ]
              : compositions[effect as DeathEffect | ImpactEffect];
  const components =
    definition[team === "red" ? "enemyComponents" : "components"];
  return components.flatMap((component) => {
    const emitter =
      definitions.emitters[
        component.emitter as keyof typeof definitions.emitters
      ];
    const sampledDuration = between(emitter.emissionLife);
    // A blank source emitter lifetime has no end time; its authored particle
    // intervals still spread a finite ParticleCount across the flight.
    const duration = sampledDuration > 0 ? sampledDuration : Infinity;
    let delay = 0;
    return Array.from({ length: emitter.count }, (_, i) => {
      const angle = between(emitter.angle),
        radius = between(emitter.radius),
        speed = between(emitter.speed);
      if (i) delay += between(emitter.interval);
      return {
        emitter,
        angle,
        ground: component.ground,
        layer: component.layer,
        scale: component.scale,
        clip: emitter.clips[Math.floor(random() * emitter.clips.length)],
        delay: component.delay + Math.min(duration, delay),
        life: between(emitter.life),
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: between(emitter.verticalSpeed),
        tailDelay:
          Math.floor(
            emitter.tailDelayMs[0] +
              tailRandom() * (emitter.tailDelayMs[1] - emitter.tailDelayMs[0]),
          ) / 1000,
      };
    });
  });
}
export function debrisPose(p: DebrisPlan, age: number) {
  const t = Math.max(0, age),
    e = p.emitter;
  // Native helper 0x7b554 subtracts Inertia from horizontal speed and integrates
  // Z using half the current-age gravity term. Nonzero inertia uses 16-ms steps
  // (0x7b65e). Evaluate that sum directly so late snapshots/replays need no history.
  // See reference/client/particle-physics-static-probe.json. Zero-inertia Z uses
  // the continuous limit; the native variable-frame correction is not retained.
  const step = 0.016;
  const steps = e.inertia ? Math.floor(t / step + 1e-9) : 0;
  const motionTime = e.inertia ? steps * step : t;
  const speed = Math.hypot(p.vx, p.vz);
  const movingSteps = e.inertia
    ? Math.min(steps, Math.max(0, Math.ceil(speed / (e.inertia * step)) - 1))
    : 0;
  const distance = e.inertia
    ? speed
      ? (step *
          (movingSteps * speed -
            (e.inertia * step * movingSteps * (movingSteps + 1)) / 2)) /
        speed
      : 0
    : t;
  const opacity = Math.min(
    1,
    e.fadeIn ? t / e.fadeIn : 1,
    e.fadeOut ? (p.life - t) / e.fadeOut : 1,
  );
  return {
    x: p.x + p.vx * distance,
    z: p.z + p.vz * distance,
    y: Math.max(
      0.04,
      e.height +
        p.vy * motionTime +
        (e.gravity * (motionTime ** 2 + (e.inertia ? motionTime * step : 0))) /
          4,
    ),
    scale:
      p.scale *
      T.MathUtils.lerp(e.startScale, e.endScale, Math.min(1, t / p.life)),
    opacity: Math.max(0, opacity),
  };
}
interface Debris {
  plan: DebrisPlan;
  origin: T.Vector3;
  start: number;
  boundsFrame?: number;
  boundsHeight?: number;
}
interface Batch {
  mesh: T.InstancedMesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  opacity: T.InstancedBufferAttribute;
  capacity: number;
  lastUsed: number;
}
interface Instance {
  position: T.Vector3;
  quaternion: T.Quaternion;
  scale: T.Vector3;
  childAngle: number;
  opacity: number;
  depth: number;
}
function particleMaterial(texture: T.Texture, ground: boolean) {
  const material = makeMaterial(texture);
  const sourceCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    sourceCompile.call(material, shader, renderer);
    shader.vertexShader =
      "attribute float particleOpacity; varying float vParticleOpacity;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvParticleOpacity = particleOpacity;",
    );
    shader.fragmentShader =
      "varying float vParticleOpacity;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      "diffuseColor.a *= vParticleOpacity;\n#include <alphatest_fragment>",
    );
  };
  material.customProgramCacheKey = () => "sc1-particle-opacity-v1";
  material.depthTest = !ground;
  return material;
}
export class DestructionEffects {
  private particles: Debris[] = [];
  private batches = new Map<string, Batch>();
  private materials = new Map<boolean, T.MeshBasicMaterial[]>();
  private clock = 0;
  private dirty = false;
  private viewQuaternion = new T.Quaternion();
  private tails = { active: 0, stretched: 0, maxStretch: 1 };
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
  get tailState() {
    return { ...this.tails };
  }
  // Advance before consuming this frame's events; upload after all bursts so
  // new effects are visible in the same rendered frame, including on pause.
  advance(dt: number) {
    if (dt > 0) {
      this.clock += dt;
      this.dirty = true;
    }
  }
  get groundCount() {
    return this.particles.filter((p) => p.plan.ground).length;
  }
  get activeClips() {
    const counts: Record<string, number> = {};
    for (const particle of this.particles)
      if (this.clock >= particle.start)
        counts[particle.plan.clip] = (counts[particle.plan.clip] ?? 0) + 1;
    return counts;
  }
  get drawCount() {
    return [...this.batches.values()].reduce(
      (sum, b) => sum + (b.mesh.visible ? b.mesh.geometry.groups.length : 0),
      0,
    );
  }
  burst(
    effect: NativeEffect,
    origin: T.Vector3,
    seed: number,
    team: Team = "blue",
    age = 0,
  ) {
    if (!this.library.asset) return;
    for (const plan of destructionPlan(effect, seed, team)) {
      if (this.particles.length >= MAX_NATIVE_PARTICLES) break;
      if (age - plan.delay >= plan.life) continue;
      if (!this.library.asset.data.clips[plan.clip]) continue;
      this.particles.push({
        plan,
        origin: origin.clone(),
        start: this.clock - age + plan.delay,
      });
      this.dirty = true;
    }
  }
  // Emit one archived looping trail cycle along the fixed projectile path.
  // Its particles keep their exact authored delays, motion and lifetimes;
  // only the moving attachment point is reconstructed from the flight rule.
  burstAlong(
    effect: TrailEffect,
    positionAt: (seconds: number) => T.Vector3,
    flightDuration: number,
    cycleStart: number,
    seed: number,
    team: Team,
    age: number,
  ) {
    if (!this.library.asset) return;
    for (const plan of destructionPlan(effect, seed, team)) {
      const emission = cycleStart + plan.delay;
      if (emission > flightDuration || age - emission >= plan.life) continue;
      if (this.particles.length >= MAX_NATIVE_PARTICLES) break;
      if (!this.library.asset.data.clips[plan.clip]) continue;
      this.particles.push({
        plan,
        origin: positionAt(emission),
        start: this.clock - age + emission,
      });
      this.dirty = true;
    }
  }
  private batch(
    key: string,
    frame: number,
    count: number,
    ground: boolean,
    order: number,
  ) {
    let batch = this.batches.get(key);
    if (batch && batch.capacity < count) {
      this.removeBatch(key, batch);
      batch = undefined;
    }
    if (!batch) {
      const asset = this.library.asset!;
      const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(count)));
      // Each batch owns its geometry/instance attributes. Native frame geometry
      // and textures remain reusable by projectiles and other effects.
      const geometry = spriteGeometry(asset, frame).clone();
      geometry.userData.shared = true; // DestructionEffects owns this lifecycle.
      const opacity = new T.InstancedBufferAttribute(
        new Float32Array(capacity),
        1,
      );
      opacity.setUsage(T.DynamicDrawUsage);
      geometry.setAttribute("particleOpacity", opacity);
      let materials = this.materials.get(ground);
      if (!materials) {
        materials = effectMaterials(asset.textures, (t) =>
          particleMaterial(t, ground),
        );
        this.materials.set(ground, materials);
      }
      const mesh = new T.InstancedMesh(geometry, materials, capacity);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      batch = { mesh, opacity, capacity, lastUsed: this.clock };
      this.batches.set(key, batch);
    }
    return batch;
  }
  update(dt: number, camera: T.Camera) {
    this.advance(dt);
    if (!this.dirty && dt <= 0 && this.viewQuaternion.equals(camera.quaternion))
      return;
    this.dirty = false;
    this.viewQuaternion.copy(camera.quaternion);
    this.tails = { active: 0, stretched: 0, maxStretch: 1 };
    if (!this.particles.length && !this.batches.size) return;
    this.particles = this.particles.filter(
      (p) => this.clock - p.start < p.plan.life,
    );
    for (const batch of this.batches.values()) batch.mesh.visible = false;
    const groups = new Map<
      string,
      { frame: number; ground: boolean; order: number; instances: Instance[] }
    >();
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const groundScale = 1 / Math.max(0.1, Math.abs(normal.y));
    for (const p of this.particles) {
      const age = this.clock - p.start;
      if (age < 0) continue;
      const pose = debrisPose(p.plan, age),
        clip = this.library.asset!.data.clips[p.plan.clip];
      const index = Math.floor(age * clip.fps);
      const frame =
        clip.frames[
          p.plan.emitter.loop
            ? index % clip.frames.length
            : Math.min(index, clip.frames.length - 1)
        ];
      const order =
        p.plan.layer === "Shadow"
          ? 0.1
          : p.plan.ground || p.plan.layer === "Ground"
            ? 0.2
            : p.plan.layer === "Base"
              ? 0.5
              : 2;
      const key = `${frame}:${order}:${Number(p.plan.ground)}`;
      let group = groups.get(key);
      if (!group) {
        group = { frame, ground: p.plan.ground, order, instances: [] };
        groups.set(key, group);
      }
      let position = new T.Vector3(
        p.origin.x + pose.x,
        p.plan.ground ? 0.195 : p.origin.y + pose.y,
        p.origin.z + pose.z,
      );
      const quaternion = p.plan.ground
        ? new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0))
        : camera.quaternion.clone();
      // spriteGeometry reflects native Y-down coordinates into local Y-up.
      // Reflect the child's emission rotation too; it remains separate from
      // the parent tail affine, whose nonuniform scale may produce shear.
      const childAngle = p.plan.emitter.rotate ? -p.plan.angle : 0;
      const scale = new T.Vector3(
        pose.scale,
        pose.scale * (p.plan.ground ? groundScale : 1),
        pose.scale,
      );
      if (p.plan.tailDelay > 0 && !p.plan.ground) {
        if (p.boundsFrame !== frame) {
          p.boundsHeight = rotatedSpriteHeight(
            spriteGeometry(this.library.asset!, frame),
            childAngle,
          );
          p.boundsFrame = frame;
        }
        // Evaluate both motion states by age, without a render-history buffer.
        // The delayed state stays at birth until its sampled age offset elapses.
        const delayed = debrisPose(p.plan, age - p.plan.tailDelay);
        const tail = particleTailPose(
          position,
          new T.Vector3(
            p.origin.x + delayed.x,
            p.origin.y + delayed.y,
            p.origin.z + delayed.z,
          ),
          camera.quaternion,
          p.boundsHeight!,
        );
        position = tail.position;
        quaternion.multiply(
          new T.Quaternion().setFromAxisAngle(
            new T.Vector3(0, 0, 1),
            tail.angle,
          ),
        );
        scale.x *= tail.stretch;
        this.tails.active++;
        if (tail.stretch > 1) this.tails.stretched++;
        this.tails.maxStretch = Math.max(this.tails.maxStretch, tail.stretch);
      }
      group.instances.push({
        position,
        quaternion,
        scale,
        childAngle,
        opacity: pose.opacity,
        depth: position.dot(normal),
      });
    }
    const matrix = new T.Matrix4(),
      childRotation = new T.Matrix4();
    for (const [key, group] of groups) {
      const batch = this.batch(
        key,
        group.frame,
        group.instances.length,
        group.ground,
        group.order,
      );
      // Transparent instances are drawn from far to near within each native frame.
      group.instances.sort((a, b) => a.depth - b.depth);
      group.instances.forEach((instance, i) => {
        matrix.compose(instance.position, instance.quaternion, instance.scale);
        if (instance.childAngle)
          matrix.multiply(childRotation.makeRotationZ(instance.childAngle));
        batch.mesh.setMatrixAt(i, matrix);
        batch.opacity.setX(i, instance.opacity);
      });
      batch.mesh.count = group.instances.length;
      batch.mesh.visible = true;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.opacity.needsUpdate = true;
      batch.lastUsed = this.clock;
    }
    // Keep a small geometry pool across frame changes, then release it at rest.
    const unused = [...this.batches]
      .filter(([, b]) => !b.mesh.visible)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, batch] of unused) {
      if (this.particles.length && this.batches.size <= 96) break;
      this.removeBatch(key, batch);
    }
  }
  private removeBatch(key: string, batch: Batch) {
    this.scene.remove(batch.mesh);
    batch.mesh.geometry.dispose();
    batch.mesh.dispose();
    this.batches.delete(key);
  }
  clear() {
    for (const [key, batch] of this.batches) this.removeBatch(key, batch);
    for (const materials of this.materials.values())
      materials.forEach((m) => m.dispose());
    this.materials.clear();
    this.particles = [];
    this.clock = 0;
    this.dirty = false;
    this.tails = { active: 0, stretched: 0, maxStretch: 1 };
  }
}
