import * as T from "three";

/** Draw the same triangles as independent vertex streams for pixel comparisons. */
export function geometryLayout(renderer: T.WebGLRenderer, scene: T.Scene) {
  let expanded = false;
  const references = new WeakMap<T.BufferGeometry, T.BufferGeometry>();
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const saved: [T.Mesh, T.BufferGeometry][] = [];
    if (expanded)
      scene.traverse((object) => {
        if (
          !(object instanceof T.Mesh) ||
          !object.geometry.getAttribute("scMultiply") ||
          !object.geometry.getIndex()
        )
          return;
        const source = object.geometry;
        let reference = references.get(source);
        if (!reference) {
          const vertices = new T.BufferGeometry();
          for (const [name, attribute] of Object.entries(source.attributes))
            if (!(attribute instanceof T.InstancedBufferAttribute))
              vertices.setAttribute(name, attribute);
          vertices.setIndex(source.getIndex());
          vertices.groups = source.groups.map((group) => ({ ...group }));
          reference = vertices.toNonIndexed();
          for (const [name, attribute] of Object.entries(source.attributes))
            if (attribute instanceof T.InstancedBufferAttribute)
              reference.setAttribute(name, attribute);
          reference.boundingSphere = source.boundingSphere?.clone() ?? null;
          references.set(source, reference);
        }
        saved.push([object, source]);
        object.geometry = reference;
      });
    try {
      render(scene, camera);
    } finally {
      for (const [object, geometry] of saved) object.geometry = geometry;
    }
  };
  return {
    setExpanded(value: boolean) {
      expanded = value;
    },
    get state() {
      const geometries = new Set<T.BufferGeometry>();
      scene.traverse((object) => {
        if (
          object instanceof T.Mesh &&
          object.geometry.getAttribute("scMultiply")
        )
          geometries.add(object.geometry);
      });
      const arrays = new Set<ArrayBufferView>();
      let vertices = 0,
        triangleVertices = 0;
      for (const geometry of geometries) {
        vertices += geometry.getAttribute("position").count;
        triangleVertices +=
          geometry.getIndex()?.count ?? geometry.getAttribute("position").count;
        for (const attribute of Object.values(geometry.attributes))
          if (!(attribute instanceof T.InstancedBufferAttribute))
            arrays.add(
              attribute instanceof T.InterleavedBufferAttribute
                ? attribute.data.array
                : attribute.array,
            );
        if (geometry.getIndex()) arrays.add(geometry.getIndex()!.array);
      }
      return {
        vertices,
        triangleVertices,
        buffers: arrays.size,
        bytes: [...arrays].reduce((sum, array) => sum + array.byteLength, 0),
      };
    },
  };
}
