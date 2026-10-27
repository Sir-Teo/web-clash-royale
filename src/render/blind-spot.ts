import * as T from "three";

/** Inner boundary for target-body overlap, separate from placement validity. */
export class BlindSpotIndicator {
  readonly object = new T.Group();
  private fill = new T.Mesh(
    new T.CircleGeometry(1, 64),
    new T.MeshBasicMaterial({
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  private boundary = new T.Mesh(
    new T.RingGeometry(0.985, 1.015, 64),
    new T.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );

  constructor() {
    this.object.visible = false;
    for (const [index, mesh] of [this.fill, this.boundary].entries()) {
      // The indicator owns disposal; skip the arena's generic geometry pass.
      mesh.geometry.userData.shared = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.085 + index * 0.005;
      this.object.add(mesh);
    }
  }

  get radius() {
    return this.object.visible ? this.object.scale.x : 0;
  }

  show(radius: number, valid: boolean) {
    this.object.visible = radius > 0;
    if (!this.object.visible) return;
    this.object.scale.set(radius, 1, radius);
    for (const mesh of [this.fill, this.boundary])
      mesh.material.color.setHex(valid ? 0xffcf78 : 0xff536a);
  }

  dispose() {
    for (const mesh of [this.fill, this.boundary]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.object.clear();
    this.object.visible = false;
  }
}
