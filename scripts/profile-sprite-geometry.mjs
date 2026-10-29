// Capture expanded native triangles and physical buffer costs without a GPU.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const reference = process.argv
  .find((arg) => arg.startsWith("--reference="))
  ?.slice(12);
if (reference && !/^[a-f0-9]{7,40}$/.test(reference))
  throw new Error("Invalid reference");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = await build({
  entryPoints: ["src/render/sprites.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: reference
    ? [
        {
          name: "committed-renderer",
          setup(builder) {
            builder.onLoad(
              { filter: /\/src\/.*\.(?:ts|json)$/ },
              ({ path }) => ({
                contents: execFileSync(
                  "git",
                  ["show", `${reference}:${relative(root, path)}`],
                  { cwd: root, encoding: "utf8" },
                ),
                loader: path.endsWith(".json") ? "json" : "ts",
              }),
            );
          },
        },
      ]
    : [],
});
const { spriteGeometry } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`
);
const attributes = ["position", "uv", "scMultiply", "scAdd"];
const files = [];
for (const folder of ["animations", "buildings", "effects"])
  for (const file of (await readdir(`public/assets/${folder}`)).sort()) {
    if (!file.endsWith(".json")) continue;
    const path = `public/assets/${folder}/${file}`;
    const source = await readFile(path);
    const data = JSON.parse(source);
    if (!data.frames || !data.shapes || !data.textures) continue;
    const asset = {
      data,
      textures: data.textures.map(() => ({})),
      materials: [],
      geometry: new Map(),
      scale: 0.027,
    };
    const hash = createHash("sha256");
    let vertices = 0,
      triangleVertices = 0,
      bytes = 0,
      buffers = 0;
    const start = performance.now();
    for (let i = 0; i < data.frames.length; i++) {
      const geometry = spriteGeometry(asset, i),
        index = geometry.getIndex();
      const count = index?.count ?? geometry.getAttribute("position").count;
      const arrays = new Set(
        Object.values(geometry.attributes).map((a) =>
          a.isInterleavedBufferAttribute ? a.data.array : a.array,
        ),
      );
      if (index) arrays.add(index.array);
      for (const array of arrays) bytes += array.byteLength;
      buffers += arrays.size;
      vertices += geometry.getAttribute("position").count;
      triangleVertices += count;
      for (const name of attributes) {
        const attribute = geometry.getAttribute(name),
          expanded = new Float32Array(count * attribute.itemSize);
        for (let v = 0; v < count; v++)
          for (let c = 0; c < attribute.itemSize; c++)
            expanded[v * attribute.itemSize + c] = attribute.getComponent(
              index ? index.getX(v) : v,
              c,
            );
        hash.update(name);
        hash.update(Buffer.from(expanded.buffer));
      }
      hash.update(
        JSON.stringify([i, geometry.groups, geometry.boundingSphere]),
      );
      geometry.dispose();
      asset.geometry.delete(i);
    }
    files.push({
      path,
      dataSha256: createHash("sha256").update(source).digest("hex"),
      frames: data.frames.length,
      trianglesSha256: hash.digest("hex"),
      vertices,
      triangleVertices,
      bytes,
      buffers,
      ms: Math.round(performance.now() - start),
    });
  }
console.log(
  JSON.stringify(
    {
      source: reference ?? "worktree",
      files,
      totals: files.reduce((sum, file) => {
        for (const name of [
          "frames",
          "vertices",
          "triangleVertices",
          "bytes",
          "buffers",
          "ms",
        ])
          sum[name] = (sum[name] ?? 0) + file[name];
        return sum;
      }, {}),
    },
    null,
    2,
  ),
);
