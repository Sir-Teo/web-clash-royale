import * as T from "three";
import type { AnimatedSprite } from "./sprites";

interface Batch {
  mesh: T.InstancedMesh<T.BufferGeometry, T.MeshBasicMaterial[]>;
  capacity: number;
  lastUsed: number;
}

/** Submit identical unfiltered animation frames once, while keeping each actor's pose. */
export class SpriteBatcher {
  private batches = new Map<T.BufferGeometry, Batch>();
  private hidden: T.Mesh[] = [];
  private frame = 0;

  constructor(private scene: T.Scene) {}

  prepare(visuals: Iterable<{ sprite?: AnimatedSprite }>, camera: T.Camera) {
    this.frame++;
    const groups = new Map<T.BufferGeometry, { asset: AnimatedSprite["asset"]; meshes: T.Mesh[] }>();
    for (const visual of visuals) {
      const sprite = visual.sprite;
      if (!sprite) continue;
      const mesh = sprite.mesh;
      // Actor-local color filters have their own material uniforms and cannot
      // share a draw call with the unfiltered source art.
      if (!mesh.visible || mesh.material !== sprite.asset.materials) continue;
      let group = groups.get(mesh.geometry);
      if (!group) {
        group = { asset: sprite.asset, meshes: [] };
        groups.set(mesh.geometry, group);
      }
      group.meshes.push(mesh);
    }
    camera.updateWorldMatrix(true, false);
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    for (const [geometry, group] of groups) {
      if (group.meshes.length < 2) continue;
      let batch = this.batches.get(geometry);
      if (batch && batch.capacity < group.meshes.length) {
        this.remove(geometry, batch);
        batch = undefined;
      }
      if (!batch) {
        const capacity = 2 ** Math.ceil(Math.log2(group.meshes.length));
        const mesh = new T.InstancedMesh(geometry, group.asset.materials, capacity);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        mesh.visible = false;
        this.scene.add(mesh);
        batch = { mesh, capacity, lastUsed: this.frame };
        this.batches.set(geometry, batch);
      }
      const ordered = group.meshes.map((mesh) => {
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld.elements;
        return { mesh, depth: m[12] * normal.x + m[13] * normal.y + m[14] * normal.z };
      }).sort((a, b) => a.depth - b.depth);
      for (let i = 0; i < ordered.length; i++) {
        const mesh = ordered[i].mesh;
        batch.mesh.setMatrixAt(i, mesh.matrixWorld);
        mesh.visible = false;
        this.hidden.push(mesh);
      }
      batch.mesh.count = ordered.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.visible = true;
      batch.lastUsed = this.frame;
    }
    // Animation caches can contain hundreds of frames. Retain recent batches
    // for reuse but release GPU instance buffers after they go quiet.
    this.prune();
  }

  idle() {
    this.frame++;
    this.prune();
  }

  finish() {
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.length = 0;
    for (const batch of this.batches.values()) batch.mesh.visible = false;
  }

  clear() {
    this.finish();
    for (const [geometry, batch] of this.batches) this.remove(geometry, batch);
  }

  private remove(geometry: T.BufferGeometry, batch: Batch) {
    this.scene.remove(batch.mesh);
    batch.mesh.dispose();
    this.batches.delete(geometry);
  }

  private prune() {
    for (const [geometry, batch] of this.batches)
      if (this.frame - batch.lastUsed > 120) this.remove(geometry, batch);
  }
}
