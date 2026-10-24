import * as T from "three";

interface Batch {
  mesh: T.InstancedMesh;
  capacity: number;
}

/** Draw troop shadows and team rings with one instance per marker. */
export class GroundBatcher {
  private batches = new Map<T.Material, Batch>();
  private hidden: T.Mesh[] = [];

  constructor(private scene: T.Scene) {}

  prepare(visuals: Iterable<{ shadow?: T.Mesh; ring?: T.Mesh }>) {
    const groups = new Map<T.Material, T.Mesh[]>();
    const add = (mesh: T.Mesh | undefined) => {
      if (!mesh || !mesh.visible || Array.isArray(mesh.material)) return;
      let group = groups.get(mesh.material);
      if (!group) groups.set(mesh.material, group = []);
      group.push(mesh);
    };
    for (const visual of visuals) {
      add(visual.shadow);
      add(visual.ring);
    }
    for (const [material, meshes] of groups) {
      if (meshes.length < 2) continue;
      let batch = this.batches.get(material);
      if (batch && batch.capacity < meshes.length) {
        this.remove(material, batch);
        batch = undefined;
      }
      if (!batch) {
        const capacity = 2 ** Math.ceil(Math.log2(meshes.length));
        const mesh = new T.InstancedMesh(meshes[0].geometry, material, capacity);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.visible = false;
        this.scene.add(mesh);
        batch = { mesh, capacity };
        this.batches.set(material, batch);
      }
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        mesh.updateWorldMatrix(true, false);
        batch.mesh.setMatrixAt(i, mesh.matrixWorld);
        mesh.visible = false;
        this.hidden.push(mesh);
      }
      batch.mesh.count = meshes.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.visible = true;
    }
  }

  finish() {
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.length = 0;
    for (const batch of this.batches.values()) batch.mesh.visible = false;
  }

  clear() {
    this.finish();
    for (const [material, batch] of this.batches) this.remove(material, batch);
  }

  private remove(material: T.Material, batch: Batch) {
    this.scene.remove(batch.mesh);
    batch.mesh.dispose();
    this.batches.delete(material);
  }
}
