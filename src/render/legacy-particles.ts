import * as T from "three";
import { mat } from "./models";

interface Particle {
  position: T.Vector3;
  velocity: T.Vector3;
  color: T.Color;
  size: number;
  life: number;
  max: number;
}

/** Small solid sparks share a single draw while keeping independent physics. */
export class LegacyParticles {
  private particles: Particle[] = [];
  private mesh: T.InstancedMesh | null = null;
  private geometry = new T.IcosahedronGeometry(1, 0);
  private matrix = new T.Matrix4();
  private scale = new T.Vector3();
  private rotation = new T.Quaternion();
  private colorsDirty = false;

  constructor(private scene: T.Scene) {}

  get count() {
    return this.particles.length;
  }

  burst(position: T.Vector3, color: number, size: number, life: number, speed: number) {
    if (this.particles.length > 400) return;
    this.particles.push({
      position: position.clone(),
      velocity: new T.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed,
        (Math.random() - 0.5) * speed,
      ),
      color: new T.Color(color),
      size,
      life,
      max: life,
    });
    this.colorsDirty = true;
  }

  update(dt: number) {
    const before = this.particles.length;
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.velocity.y -= dt * 5;
      particle.position.addScaledVector(particle.velocity, dt);
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    if (this.particles.length !== before) this.colorsDirty = true;
    if (!this.particles.length) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh || this.mesh.instanceMatrix.count < this.particles.length) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      const capacity = 2 ** Math.ceil(Math.log2(this.particles.length));
      this.mesh = new T.InstancedMesh(this.geometry, mat(0xffffff), capacity);
      this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      this.colorsDirty = true;
    }
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const size = particle.size * Math.max(0, particle.life / particle.max);
      this.scale.setScalar(size);
      this.matrix.compose(particle.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      if (this.colorsDirty) this.mesh.setColorAt(i, particle.color);
    }
    this.mesh.count = this.particles.length;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorsDirty) this.mesh.instanceColor!.needsUpdate = true;
    this.colorsDirty = false;
  }

  clear() {
    this.particles = [];
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.colorsDirty = false;
  }

  destroy() {
    this.clear();
    this.geometry.dispose();
  }
}
