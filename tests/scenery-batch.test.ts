import { expect, it, vi } from "vitest";
import * as T from "three";
import { batchSceneryColors } from "../src/render/models";
import { makeMaterial } from "../src/render/sprites";

it("combines static colors and preserves positions, lighting and source materials", () => {
  const group = new T.Group();
  const red = new T.MeshStandardMaterial({ color: 0xff0000, roughness: 0.78 });
  const blue = new T.MeshStandardMaterial({ color: 0x0000ff, roughness: 0.78 });
  const left = new T.Mesh(new T.BoxGeometry(), red),
    right = new T.Mesh(new T.BoxGeometry(), blue);
  left.position.x = -3;
  right.position.x = 3;
  left.receiveShadow = true;
  right.castShadow = true;
  const release = vi.fn();
  left.geometry.addEventListener("dispose", release);
  right.geometry.addEventListener("dispose", release);
  group.add(left, right);
  batchSceneryColors(group);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as T.Mesh<
    T.BufferGeometry,
    T.MeshStandardMaterial
  >;
  expect(mesh.material.vertexColors).toBe(true);
  expect(mesh.material.color.getHex()).toBe(0xffffff);
  expect(mesh.material.roughness).toBe(0.78);
  expect(red.color.getHex()).toBe(0xff0000);
  expect(blue.color.getHex()).toBe(0x0000ff);
  expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
  const colors = mesh.geometry.attributes.color;
  expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 0, 0]);
  expect([colors.getX(24), colors.getY(24), colors.getZ(24)]).toEqual([
    0, 0, 1,
  ]);
  mesh.geometry.computeBoundingBox();
  expect(mesh.geometry.boundingBox!.min.x).toBe(-3.5);
  expect(mesh.geometry.boundingBox!.max.x).toBe(3.5);
  expect(release).toHaveBeenCalledTimes(2);
});

it("leaves animated, instanced, textured and incompatible surfaces separate", () => {
  const group = new T.Group(),
    material = new T.MeshStandardMaterial();
  const first = new T.Mesh(new T.BoxGeometry(), material),
    second = first.clone();
  // Real scenery objects own their primitive geometries.
  second.geometry = first.geometry.clone();
  const animated = new T.Mesh(new T.PlaneGeometry(), material);
  const translucent = new T.Mesh(
    new T.PlaneGeometry(),
    new T.MeshStandardMaterial({ transparent: true }),
  );
  const textured = new T.Mesh(
    new T.PlaneGeometry(),
    new T.MeshStandardMaterial({ map: new T.Texture() }),
  );
  const polished = new T.Mesh(
    new T.BoxGeometry(),
    new T.MeshStandardMaterial({ roughness: 0.1 }),
  );
  const instances = new T.InstancedMesh(new T.BoxGeometry(), material, 2);
  group.add(
    first,
    second,
    animated,
    translucent,
    textured,
    polished,
    instances,
  );
  batchSceneryColors(group, [animated]);
  expect(group.children).toHaveLength(6);
  for (const object of [animated, translucent, textured, polished, instances])
    expect(object.parent).toBe(group);
});

it("uses a single two-sided pass for native flat artwork and its clones", () => {
  const material = makeMaterial(new T.Texture());
  expect(material.transparent).toBe(true);
  expect(material.side).toBe(T.DoubleSide);
  expect(material.forceSinglePass).toBe(true);
  expect(material.clone().forceSinglePass).toBe(true);
});
