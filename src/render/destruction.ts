import * as T from "three";
import definitions from "./destruction-data.json";
import { makeMaterial, spriteGeometry } from "./sprites";
import type { EffectLibrary } from "./effects";
import type { Team } from "../game/engine";

type Emitter = (typeof definitions.emitters)[keyof typeof definitions.emitters];
export type DeathEffect = keyof typeof definitions.effects;
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
  angle: number;
  ground: boolean;
  layer: string;
  scale: number;
}
// Cosmetic RNG is separate from Battle's RNG and is stable during replay.
export function destructionPlan(
  effect: DeathEffect,
  seed: number,
  team: Team = "blue",
): DebrisPlan[] {
  let state = seed | 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  const between = (range: number[]) =>
    range[0] + random() * (range[1] - range[0]);
  const components =
    definitions.effects[effect][
      team === "red" ? "enemyComponents" : "components"
    ];
  return components.flatMap((component) => {
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
      };
    });
  });
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
    effect: DeathEffect,
    origin: T.Vector3,
    seed: number,
    team: Team = "blue",
    age = 0,
  ) {
    if (!this.library.asset) return;
    for (const plan of destructionPlan(effect, seed, team)) {
      if (this.particles.length >= 1024) break;
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
        materials = asset.textures.map((t) => particleMaterial(t, ground));
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
    this.clock += Math.max(0, dt);
    if (!this.dirty && dt <= 0 && this.viewQuaternion.equals(camera.quaternion))
      return;
    this.dirty = false;
    this.viewQuaternion.copy(camera.quaternion);
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
      const order = p.plan.ground
        ? p.plan.layer === "Shadow"
          ? 0.1
          : 0.2
        : p.plan.layer === "Base"
          ? 0.5
          : 2;
      const key = `${frame}:${order}`;
      let group = groups.get(key);
      if (!group) {
        group = { frame, ground: p.plan.ground, order, instances: [] };
        groups.set(key, group);
      }
      const position = new T.Vector3(
        p.origin.x + pose.x,
        p.plan.ground ? 0.195 : p.origin.y + pose.y,
        p.origin.z + pose.z,
      );
      const quaternion = p.plan.ground
        ? new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0))
        : camera.quaternion.clone();
      if (p.plan.emitter.rotate)
        quaternion.multiply(
          new T.Quaternion().setFromAxisAngle(
            new T.Vector3(0, 0, 1),
            p.plan.angle,
          ),
        );
      const scale = new T.Vector3(
        pose.scale,
        pose.scale * (p.plan.ground ? groundScale : 1),
        pose.scale,
      );
      group.instances.push({
        position,
        quaternion,
        scale,
        opacity: pose.opacity,
        depth: position.dot(normal),
      });
    }
    const matrix = new T.Matrix4();
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
  }
}
