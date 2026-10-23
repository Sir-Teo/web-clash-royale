import * as T from "three";

export interface SpriteFilterColor {
  add: T.Vector3;
  multiply: T.Vector4;
}

/** Apply an actor-local SC color transform after the artwork's own transform. */
export function filteredSpriteMaterials(
  originals: readonly T.MeshBasicMaterial[],
  color: SpriteFilterColor,
) {
  return originals.map((original) => {
    const material = original.clone();
    material.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile(shader, renderer);
      shader.uniforms.scFilterAdd = { value: color.add };
      shader.uniforms.scFilterMultiply = { value: color.multiply };
      const before = "sourceColor.a *= vScMultiply.a;";
      if (!shader.fragmentShader.includes(before))
        throw new Error("Missing SC color transform in sprite filter material");
      shader.fragmentShader =
        "uniform vec3 scFilterAdd; uniform vec4 scFilterMultiply;\n" +
        shader.fragmentShader.replace(
          before,
          `sourceColor.rgb = clamp(sourceColor.rgb * scFilterMultiply.rgb + scFilterAdd, 0.0, 1.0);\n      ${before}\n      sourceColor.a *= scFilterMultiply.a;`,
        );
    };
    material.customProgramCacheKey = () => "sc1-sprite-filter-v1";
    return material;
  });
}
