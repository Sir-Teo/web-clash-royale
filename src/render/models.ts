import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CardId } from "../game/cards";
import type { Team } from "../game/engine";
const materials = new Map<string, T.MeshStandardMaterial>();

/** Merge the opaque diorama's colors into vertex data instead of separate draws. */
export function batchSceneryColors(group: T.Group, exclude: T.Object3D[] = []) {
  group.updateMatrixWorld(true);
  const skip = new Set<T.Object3D>();
  for (const object of exclude) object.traverse((child) => skip.add(child));
  const groups = new Map<
    string,
    {
      material: T.MeshStandardMaterial;
      objects: T.Mesh[];
      geometries: T.BufferGeometry[];
    }
  >();
  group.traverse((object) => {
    if (
      !(object instanceof T.Mesh) ||
      object instanceof T.InstancedMesh ||
      skip.has(object) ||
      Array.isArray(object.material)
    )
      return;
    const material = object.material;
    if (
      !(material instanceof T.MeshStandardMaterial) ||
      material.transparent ||
      material.map ||
      material.vertexColors ||
      material.normalMap ||
      material.roughnessMap ||
      material.metalnessMap ||
      material.alphaMap ||
      material.emissiveMap ||
      material.aoMap ||
      material.lightMap ||
      material.displacementMap ||
      material.bumpMap
    )
      return;
    const key = [
      material.roughness,
      material.metalness,
      material.side,
      material.flatShading,
      material.opacity,
      material.depthTest,
      material.depthWrite,
      material.toneMapped,
      material.emissive.getHex(),
      material.emissiveIntensity,
    ].join(":");
    let batch = groups.get(key);
    if (!batch)
      groups.set(key, (batch = { material, objects: [], geometries: [] }));
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = material.color.r;
      colors[i + 1] = material.color.g;
      colors[i + 2] = material.color.b;
    }
    geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
    batch.geometries.push(geometry);
    batch.objects.push(object);
  });
  for (const batch of groups.values()) {
    if (batch.objects.length < 2) {
      batch.geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    const geometry = mergeGeometries(batch.geometries, false);
    batch.geometries.forEach((part) => part.dispose());
    if (!geometry) continue;
    const material = batch.material.clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = batch.objects.some((object) => object.castShadow);
    mesh.receiveShadow = batch.objects.some((object) => object.receiveShadow);
    for (const object of batch.objects) {
      object.removeFromParent();
      object.geometry.dispose();
    }
    group.add(mesh);
  }
}
export function mat(
  color: T.ColorRepresentation,
  roughness = 0.78,
  metalness = 0,
) {
  const key = `${color}-${roughness}-${metalness}`;
  if (!materials.has(key))
    materials.set(
      key,
      new T.MeshStandardMaterial({ color, roughness, metalness }),
    );
  return materials.get(key)!;
}
export const teamColor = (team: Team) =>
  team === "blue" ? 0x389ae7 : 0xe64c50;
export function box(
  g: T.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  c: T.ColorRepresentation,
) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function sphere(
  g: T.Group,
  x: number,
  y: number,
  z: number,
  r: number,
  c: T.ColorRepresentation,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const m = new T.Mesh(new T.SphereGeometry(r, 12, 10), mat(c));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  g.add(m);
  return m;
}
export function cylinder(
  g: T.Group,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  c: T.ColorRepresentation,
  top = r,
  sides = 12,
) {
  const m = new T.Mesh(new T.CylinderGeometry(top, r, h, sides), mat(c));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function limb(
  g: T.Group,
  x: number,
  y: number,
  z: number,
  len: number,
  r: number,
  color: T.ColorRepresentation,
) {
  const p = new T.Group();
  p.position.set(x, y, z);
  cylinder(p, 0, -len / 2, 0, r, len, color);
  sphere(p, 0, -len, 0, r, color);
  g.add(p);
  return p;
}
function eyes(g: T.Group, y: number, z: number, spread = 0.13) {
  for (const s of [-1, 1]) {
    sphere(g, s * spread, y, z, 0.065, 0xffffff, 1, 1.2, 0.55);
    sphere(g, s * spread, y, z + 0.035, 0.031, 0x18313b, 1, 1.2, 0.55);
  }
}
function sword(g: T.Group, x: number, y: number, z: number, size = 1) {
  const arm = new T.Group();
  arm.position.set(x, y, z);
  box(arm, 0, 0.45 * size, 0, 0.13 * size, 0.9 * size, 0.07 * size, 0xd2e2e8);
  box(arm, 0, 0, 0, 0.4 * size, 0.08 * size, 0.1 * size, 0xeab44a);
  cylinder(arm, 0, -0.17 * size, 0, 0.065 * size, 0.27 * size, 0x724e2d);
  g.add(arm);
  arm.rotation.z = -0.18;
  return arm;
}
export interface Model {
  group: T.Group;
  legs: T.Group[];
  arms: T.Group[];
  wings: T.Group[];
  head?: T.Group;
  scale: number;
}
export function batchGeometry(group: T.Group, exclude: T.Object3D[] = []) {
  group.updateMatrixWorld(true);
  const skip = new Set<T.Object3D>();
  for (const o of exclude) o.traverse((child) => skip.add(child));
  const byMaterial = new Map<
    T.Material,
    { geometries: T.BufferGeometry[]; objects: T.Mesh[] }
  >();
  group.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      o instanceof T.InstancedMesh ||
      skip.has(o) ||
      Array.isArray(o.material) ||
      o.material.transparent
    )
      return;
    let bucket = byMaterial.get(o.material);
    if (!bucket) {
      bucket = { geometries: [], objects: [] };
      byMaterial.set(o.material, bucket);
    }
    bucket.geometries.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    bucket.objects.push(o);
  });
  for (const [material, b] of byMaterial) {
    if (b.objects.length < 2) {
      for (const g of b.geometries) g.dispose();
      continue;
    }
    const geometry = mergeGeometries(b.geometries, false);
    if (!geometry) continue;
    const m = new T.Mesh(geometry, material);
    m.castShadow = true;
    m.receiveShadow = true;
    for (const o of b.objects) {
      o.removeFromParent();
      o.geometry.dispose();
    }
    for (const g of b.geometries) g.dispose();
    group.add(m);
  }
}
export function troopModel(id: CardId, team: Team): Model {
  const group = new T.Group(),
    legs: T.Group[] = [],
    arms: T.Group[] = [],
    wings: T.Group[] = [];
  const color = teamColor(team),
    skin = 0xf7bd80;
  let scale = 1;
  const humanoid = (
    body: T.ColorRepresentation,
    head: T.ColorRepresentation = skin,
  ) => {
    cylinder(group, 0, 0.7, 0, 0.29, 0.65, body, 0.36);
    sphere(group, 0, 1.28, 0, 0.32, head, 0.95, 1.08, 0.9);
    eyes(group, 1.33, 0.27);
    for (const s of [-1, 1]) {
      legs.push(limb(group, s * 0.16, 0.4, 0, 0.3, 0.115, 0x6b4e38));
      box(legs.at(-1)!, 0, -0.3, 0.06, 0.24, 0.17, 0.36, 0x50402f);
      arms.push(limb(group, s * 0.4, 1, 0, 0.4, 0.13, head));
    }
    cylinder(group, 0, 0.61, 0, 0.315, 0.15, color);
    box(group, 0, 0.61, 0.305, 0.15, 0.13, 0.07, 0xffd05a);
  };
  if (id === "balloon") {
    scale = 1.25;
    cylinder(group, 0, 0.45, 0, 0.34, 0.5, 0xb07b3d, 0.44, 8);
    box(group, 0, 0.3, 0, 0.6, 0.12, 0.6, 0x765239);
    for (const x of [-0.34, 0.34])
      for (const z of [-0.34, 0.34]) {
        const r = cylinder(group, x, 1.2, z, 0.025, 1.6, 0xceb387);
        r.rotation.z = -x * 0.3;
      }
    sphere(group, 0, 2.25, 0, 1.05, color, 1, 1.2, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const strip = cylinder(
        group,
        Math.cos(a) * 0.81,
        2.25,
        Math.sin(a) * 0.81,
        0.035,
        1.45,
        0xe7c582,
      );
      strip.rotation.z = Math.cos(a) * 0.3;
      strip.rotation.x = Math.sin(a) * 0.3;
    }
    sphere(group, 0, 0.7, 0.3, 0.18, 0xf5ecda);
    eyes(group, 0.74, 0.45, 0.07);
    sphere(group, 0, 0.13, 0, 0.27, 0x33363b);
  } else if (
    id === "baby-dragon" ||
    id === "minions" ||
    id === "minion-horde"
  ) {
    const dragon = id === "baby-dragon";
    const c = dragon ? 0x75b943 : 0x6393d5;
    scale = dragon ? 1.1 : 0.7;
    sphere(group, 0, 0.65, 0, 0.44, c, 1, 1, 1.3);
    sphere(group, 0, 1.05, 0.3, 0.36, c);
    sphere(group, 0, 0.98, 0.57, 0.25, dragon ? 0xb6d56d : c, 1.2, 0.7, 1.2);
    eyes(group, 1.18, 0.56, 0.17);
    for (const s of [-1, 1]) {
      const wing = new T.Group();
      wing.position.set(s * 0.3, 0.9, -0.1);
      const shape = new T.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(s * 1, 0.6);
      shape.lineTo(s * 0.7, -0.35);
      shape.lineTo(s * 0.25, -0.15);
      shape.closePath();
      const m = new T.Mesh(
        new T.ShapeGeometry(shape),
        new T.MeshStandardMaterial({
          color: dragon ? 0xe9bd77 : 0x8fb9ea,
          side: T.DoubleSide,
          roughness: 1,
        }),
      );
      wing.add(m);
      group.add(wing);
      wings.push(wing);
      limb(group, s * 0.23, 0.35, 0.1, 0.25, 0.08, c);
      cylinder(group, s * 0.18, 1.4, 0.24, 0.09, 0.3, 0xe6d3a6, 0, 6);
    }
    const tail = cylinder(group, 0, 0.57, -0.6, 0.15, 0.7, c, 0.03, 8);
    tail.rotation.x = Math.PI / 2;
  } else if (id === "hog-rider" || id === "prince") {
    const hog = id === "hog-rider";
    sphere(group, 0, 0.55, 0, 0.42, hog ? 0xbd8462 : 0x987555, 1, 1, 1.5);
    sphere(group, 0, 0.8, 0.55, 0.3, hog ? 0xc69579 : 0xae8158);
    sphere(group, 0, 0.7, 0.8, 0.18, hog ? 0xdda889 : 0x9b7254, 1.2, 0.8, 1);
    for (const s of [-1, 1])
      for (const z of [-0.35, 0.35])
        legs.push(limb(group, s * 0.26, 0.4, z, 0.3, 0.09, 0x77533e));
    for (const s of [-1, 1]) {
      const ear = cylinder(group, s * 0.22, 1, 0.55, 0.1, 0.35, 0x956f52, 0, 5);
      ear.rotation.z = s * 0.2;
    }
    cylinder(group, 0, 1.12, -0.1, 0.24, 0.5, hog ? 0x815339 : color);
    sphere(group, 0, 1.6, -0.1, 0.25, hog ? 0x9b6745 : skin);
    eyes(group, 1.65, 0.13, 0.1);
    if (hog) {
      box(group, 0, 1.85, -0.1, 0.12, 0.2, 0.35, 0x352f32);
      const hammer = new T.Group();
      hammer.position.set(0.4, 1.25, 0);
      cylinder(hammer, 0, 0.25, 0, 0.06, 0.8, 0x744323);
      box(hammer, 0, 0.65, 0, 0.42, 0.25, 0.3, 0x797e88);
      group.add(hammer);
      arms.push(hammer);
    } else {
      sphere(group, 0, 1.7, -0.15, 0.28, 0xbfcbd4, 1, 1, 1);
      cylinder(group, 0, 1.98, -0.1, 0.1, 0.4, color, 0);
      const lance = cylinder(group, 0.48, 1.1, 0.5, 0.05, 2.6, 0xd5b786);
      lance.rotation.x = Math.PI / 2.5;
      arms.push(lance as unknown as T.Group);
    }
  } else if (["skeletons", "skeleton-army", "bomber"].includes(id)) {
    scale = id === "bomber" ? 0.85 : 0.68;
    cylinder(group, 0, 0.73, 0, 0.09, 0.6, 0xe9e2cc);
    for (let i = 0; i < 3; i++)
      sphere(group, 0, 0.65 + i * 0.13, 0, 0.23, 0xe9e2cc, 1, 0.2, 0.75);
    sphere(group, 0, 1.27, 0.03, 0.32, 0xf3e9ce);
    for (const s of [-1, 1])
      sphere(group, s * 0.13, 1.3, 0.3, 0.095, 0x3f4240, 1, 1.2, 0.6);
    box(group, 0, 1.09, 0.25, 0.22, 0.11, 0.14, 0xe8deca);
    for (const s of [-1, 1]) {
      legs.push(limb(group, s * 0.12, 0.45, 0, 0.36, 0.055, 0xece2ca));
      arms.push(limb(group, s * 0.23, 0.93, 0, 0.4, 0.05, 0xece2ca));
    }
    if (id === "bomber") {
      sphere(group, 0.35, 0.85, 0.32, 0.3, 0x35363b);
      cylinder(group, 0.35, 1.18, 0.32, 0.035, 0.15, 0xc6a569);
      sphere(group, 0.35, 1.27, 0.32, 0.06, 0xffac35);
      sphere(group, 0, 1.46, 0, 0.32, 0x744c39, 1, 0.5, 1);
    } else sword(group, 0.3, 0.7, 0.2, 0.6);
  } else if (id === "goblins" || id === "spear-goblins") {
    scale = 0.68;
    humanoid(0x8b633d, 0x81c24e);
    sphere(group, 0, 1.3, 0.36, 0.13, 0x81c24e, 0.7, 1.4, 1.7);
    for (const s of [-1, 1]) {
      const ear = cylinder(
        group,
        s * 0.39,
        1.36,
        0,
        0.16,
        0.45,
        0x81c24e,
        0,
        5,
      );
      ear.rotation.z = (-s * Math.PI) / 2.2;
    }
    if (id === "spear-goblins") {
      cylinder(group, 0.42, 1, 0.2, 0.035, 1.8, 0x8f632c);
      cylinder(group, 0.42, 1.95, 0.2, 0.09, 0.3, 0xced8dc, 0, 4);
    } else sword(group, 0.4, 0.65, 0.2, 0.65);
  } else if (id === "giant") {
    scale = 1.65;
    humanoid(0x9a673a);
    sphere(group, 0, 1.35, -0.1, 0.34, 0xe69537, 1.1, 1, 1);
    sphere(group, 0, 1.28, 0.1, 0.3, skin);
    eyes(group, 1.36, 0.37);
    box(group, 0, 0.85, 0.29, 0.28, 0.5, 0.08, skin);
    for (const s of [-1, 1])
      box(group, s * 0.24, 1.23, 0.16, 0.13, 0.3, 0.2, 0xe79231);
  } else if (id === "mini-pekka" || id === "pekka") {
    scale = id === "pekka" ? 1.5 : 0.95;
    humanoid(0x687b90, 0x8397a5);
    box(group, 0, 1.3, 0.27, 0.45, 0.16, 0.08, 0x1e293c);
    for (const s of [-1, 1]) {
      sphere(
        group,
        s * 0.12,
        1.33,
        0.33,
        0.055,
        id === "pekka" ? 0xd962ef : 0x71cfff,
      );
      const horn = cylinder(
        group,
        s * 0.29,
        1.66,
        0,
        0.1,
        0.45,
        id === "pekka" ? 0xae77cd : 0xbacbd3,
        0,
        6,
      );
      horn.rotation.z = -s * 0.45;
      box(group, s * 0.4, 0.99, 0, 0.29, 0.32, 0.42, 0x879baa);
    }
    arms.push(sword(group, 0.48, 0.65, 0.23, 1.25));
  } else if (
    id === "archers" ||
    id === "musketeer" ||
    id === "three-musketeers"
  ) {
    humanoid(color);
    sphere(group, 0, 1.33, -0.06, 0.34, 0xa45ac1, 1.05, 1.1, 1.05);
    sphere(group, 0, 1.3, 0.15, 0.27, skin);
    eyes(group, 1.34, 0.38);
    if (id === "archers") {
      const bow = new T.Mesh(
        new T.TorusGeometry(0.36, 0.045, 6, 14, Math.PI),
        mat(0xb89054),
      );
      bow.position.set(0.43, 0.8, 0.2);
      bow.rotation.z = -Math.PI / 2;
      group.add(bow);
      box(group, 0.44, 0.8, 0.2, 0.015, 0.7, 0.015, 0xe9dcba);
    } else {
      sphere(group, 0, 1.55, -0.05, 0.35, 0xb0bcc8, 1.1, 0.6, 1.1);
      const gun = cylinder(group, 0.35, 0.88, 0.35, 0.09, 0.95, 0x727f8d);
      gun.rotation.x = Math.PI / 2;
      box(group, 0.35, 0.8, 0.05, 0.17, 0.2, 0.6, 0x81532d);
    }
  } else if (id === "witch" || id === "wizard") {
    const witch = id === "witch";
    humanoid(witch ? 0x5e4194 : color);
    cylinder(group, 0, 0.5, 0, 0.43, 0.8, witch ? 0x57408e : color, 0.26);
    sphere(group, 0, 1.42, -0.04, 0.35, witch ? 0x61508c : color, 1.1, 1.1, 1);
    sphere(group, 0, 1.29, 0.18, 0.26, skin);
    eyes(group, 1.36, 0.4);
    if (witch) {
      cylinder(group, 0, 1.85, 0, 0.35, 0.7, 0x4e3877, 0);
      cylinder(group, 0.42, 0.95, 0.12, 0.045, 1.6, 0x74522e);
      sphere(group, 0.42, 1.85, 0.12, 0.18, 0x9de9f4);
    } else {
      sphere(group, 0, 1.13, 0.36, 0.17, 0x6e4933, 1, 1, 0.5);
      sphere(group, 0.5, 0.95, 0.24, 0.15, 0xffa52a);
    }
  } else if (id === "valkyrie") {
    humanoid(0x82623e);
    sphere(group, 0, 1.37, -0.04, 0.36, 0xe88b2f, 1.1, 1.15, 1);
    sphere(group, 0, 1.3, 0.15, 0.28, skin);
    eyes(group, 1.35, 0.39);
    cylinder(group, 0.47, 0.9, 0, 0.055, 1.45, 0x946c3d);
    const blade = box(group, 0.5, 1.4, 0, 0.65, 0.35, 0.13, 0xb6c4ca);
    blade.rotation.z = -0.2;
  } else {
    humanoid(0x9aa8b0);
    sphere(group, 0, 1.49, -0.05, 0.34, 0xaebbc1, 1.05, 0.7, 1.05);
    sphere(group, 0, 1.17, 0.3, 0.14, 0xf6cd55, 1.6, 0.5, 0.5);
    arms.push(sword(group, 0.48, 0.7, 0.2));
  }
  batchGeometry(group, [...legs, ...arms, ...wings]);
  group.scale.setScalar(scale);
  return { group, legs, arms, wings, scale };
}
export function towerModel(team: Team, king = false): T.Group {
  const g = new T.Group(),
    c = teamColor(team),
    w = king ? 2.8 : 2.1;
  box(g, 0, 0.12, 0, w + 0.55, 0.35, w + 0.45, 0x6f7b83);
  box(g, 0, 0.37, 0, w + 0.25, 0.22, w + 0.25, 0xc1c0ab);
  box(g, 0, 1.25, 0, w, 1.6, w, 0xc5c4af);
  box(g, 0, 0.55, 0, w + 0.05, 0.18, w + 0.05, 0x9a9e96);
  for (let row = 0; row < 3; row++)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / 3;
        box(
          g,
          x,
          0.8 + row * 0.45,
          side * (w / 2 + 0.005),
          w / 3 - 0.04,
          0.035,
          0.025,
          0x989d92,
        );
      }
      box(g, side * (w / 2 + 0.007), 1.2, 0, 0.025, 1.3, 0.04, 0xa4aa9d);
    }
  box(g, 0, 1.72, 0, w + 0.16, 0.28, w + 0.16, c);
  box(g, 0, 1.92, 0, w + 0.32, 0.18, w + 0.32, 0xd3d0b7);
  box(g, 0, 2.02, 0, w - 0.25, 0.11, w - 0.25, 0x8f8f7e);
  for (const x of [-1, 0, 1])
    for (const z of [-1, 1])
      box(g, x * (w / 2 - 0.18), 2.25, z * (w / 2 - 0.08), 0.38, 0.48, 0.4, c);
  for (const s of [-1, 1])
    box(g, s * (w / 2 - 0.08), 2.25, 0, 0.4, 0.48, 0.38, c);
  const badge = new T.Group();
  badge.position.set(0, 1.25, w / 2 + 0.03);
  box(badge, 0, 0, 0, 0.55, 0.55, 0.08, c);
  for (let i = -1; i < 2; i++)
    box(
      badge,
      i * 0.15,
      0.05,
      0.07,
      0.13,
      i === 0 ? 0.28 : 0.2,
      0.035,
      0xffd05b,
    );
  box(badge, 0, -0.1, 0.07, 0.43, 0.08, 0.035, 0xffd05b);
  g.add(badge);
  if (king) {
    cylinder(g, 0, 2.25, 0, 0.66, 0.35, 0x6b6c6c);
    const cannon = cylinder(g, 0, 2.65, 0.38, 0.33, 1.3, 0x424c5c);
    cannon.rotation.x = Math.PI / 2;
    const muzzle = cylinder(g, 0, 2.65, 1.02, 0.24, 0.02, 0x1d2735);
    muzzle.rotation.x = Math.PI / 2;
    sphere(g, 0, 3, -0.3, 0.35, 0xf7bd80);
    sphere(g, 0, 2.83, -0.1, 0.24, 0x49362b, 1.2, 0.7, 0.8);
    eyes(g, 3.07, -0.01);
    cylinder(g, 0, 3.33, -0.3, 0.35, 0.23, 0xffce57, 0.35, 8);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      box(
        g,
        Math.cos(a) * 0.3,
        3.52,
        -0.3 + Math.sin(a) * 0.3,
        0.13,
        0.24,
        0.13,
        0xffce57,
      );
    }
  } else {
    cylinder(g, 0, 2.4, -0.1, 0.26, 0.6, c);
    sphere(g, 0, 2.91, -0.1, 0.24, 0xa560bd);
    sphere(g, 0, 2.87, 0.05, 0.21, 0xf7c296);
    eyes(g, 2.92, 0.23, 0.09);
    const bow = new T.Mesh(
      new T.TorusGeometry(0.3, 0.035, 5, 12, Math.PI),
      mat(0xa47b46),
    );
    bow.position.set(0.3, 2.5, 0.2);
    g.add(bow);
  }
  batchGeometry(g);
  return g;
}
export function buildingModel(id: CardId, team: Team) {
  const g = new T.Group(),
    c = teamColor(team);
  box(g, 0, 0.15, 0, 1.5, 0.3, 1.5, 0x8b918e);
  if (id === "tesla") {
    box(g, 0, 0.6, 0, 0.75, 0.8, 0.75, 0x875d39);
    cylinder(g, 0, 1.35, 0, 0.18, 1.25, 0x8fa0b2);
    for (let i = 0; i < 4; i++)
      cylinder(g, 0, 1.1 + i * 0.22, 0, 0.35, 0.1, 0xa7c9dc);
    sphere(g, 0, 2, 0, 0.25, 0xa9e9ff);
  } else {
    cylinder(g, 0, 0.5, 0, 0.45, 0.35, c);
    const barrel = cylinder(g, 0, 0.85, 0.15, 0.26, 1.2, 0x485466);
    barrel.rotation.x = Math.PI / 2.2;
    for (const x of [-0.55, 0.55]) {
      const wheel = cylinder(g, x, 0.55, 0, 0.34, 0.15, 0x9d733f);
      wheel.rotation.z = Math.PI / 2;
    }
  }
  return g;
}
