// Measure cached typed-array bytes, not process RSS or physical GPU memory.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import * as T from "three";
const mib = Number(
  process.argv.find((arg) => arg.startsWith("--budget-mib="))?.split("=")[1] ??
    8,
);
if (!Number.isFinite(mib) || mib < 0) throw new Error("Invalid cache budget");
const { outputFiles } = await build({
  stdin: {
    contents:
      'export { SpriteLibrary, spriteGeometry } from "./src/render/sprites.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { SpriteLibrary, spriteGeometry } = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].contents).toString("base64")
);
const library = new SpriteLibrary();
const manifest = JSON.parse(
  readFileSync("public/assets/animations/manifest.json", "utf8"),
);
const start = performance.now();
for (const { id } of manifest.files) {
  const data = JSON.parse(
    readFileSync(`public/assets/animations/${id}.json`, "utf8"),
  );
  const asset = {
    data,
    textures: data.textures.map(() => new T.Texture()),
    materials: [],
    geometry: new Map(),
    scale: 1,
  };
  library.assets.set(id, asset);
  for (let frame = 0; frame < data.frames.length; frame++)
    spriteGeometry(asset, frame);
}
const measure = () => {
  let frames = 0,
    bytes = 0;
  for (const asset of library.assets.values())
    for (const geometry of asset.geometry.values()) {
      frames++;
      for (const attribute of Object.values(geometry.attributes))
        bytes += attribute.array.byteLength;
    }
  return { frames, bytes, mib: bytes / 1048576 };
};
const before = measure(),
  warmMs = performance.now() - start,
  trimStart = performance.now();
if (library.trimGeometryCache) library.trimGeometryCache(mib * 1048576);
const after = measure();
console.log(
  JSON.stringify(
    {
      assets: library.assets.size,
      budgetMiB: mib,
      trimAvailable: !!library.trimGeometryCache,
      warmMs,
      trimMs: performance.now() - trimStart,
      before,
      after,
      releasedBytes: before.bytes - after.bytes,
    },
    null,
    2,
  ),
);
library.destroy();
