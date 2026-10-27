import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "eccdaa5";
const { outputFiles } = await build({
  stdin: {
    contents:
      'export { Battle } from "./src/game/engine.ts"; export * from "./tests/fixtures/separation-scenes.ts";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "historical-separation",
      setup(builder) {
        builder.onLoad({ filter: /\/src\/.*\.(?:ts|json)$/ }, ({ path }) => ({
          contents: execFileSync(
            "git",
            ["show", `${sourceCommit}:${relative(root, path)}`],
            { cwd: root, encoding: "utf8" },
          ),
          loader: path.endsWith(".json") ? "json" : "ts",
        }));
      },
    },
  ],
});
const { Battle, separationCases, separationScene, separationPositions } =
  await import(
    "data:text/javascript;base64," +
      Buffer.from(outputFiles[0].contents).toString("base64")
  );
const cases = separationCases.map((spec) => {
  const battle = separationScene(Battle, spec),
    checkpoints = [];
  for (let step = 0; step <= 30; step++) {
    if ([0, 1, 2, 5, 30].includes(step))
      checkpoints.push({
        step,
        digest: createHash("sha256")
          .update(JSON.stringify(separationPositions(battle.entities)))
          .digest("hex"),
      });
    if (step < 30) battle.separate();
  }
  return { name: spec.name, checkpoints };
});
const path = new URL(
  "../tests/fixtures/separation-golden.json",
  import.meta.url,
);
const output = JSON.stringify({ sourceCommit, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Separation differs from historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({ cases: cases.length, checkpoints: cases.length * 5 }),
);
