import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "93e3f47";
const r = await build({
  stdin: {
    contents:
      'export {Battle} from "./src/game/engine.ts";export {CARDS} from "./src/game/cards.ts";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "original-movement",
      setup(b) {
        b.onLoad({ filter: /\/src\/game\/.*\.(?:ts|json)$/ }, (args) => ({
          contents: execFileSync(
            "git",
            ["show", sourceCommit + ":" + relative(root, args.path)],
            { cwd: root, encoding: "utf8" },
          ),
          loader: args.path.endsWith(".json") ? "json" : "ts",
        }));
      },
    },
  ],
});
const { Battle, CARDS } = await import(
  "data:text/javascript;base64," +
    Buffer.from(r.outputFiles[0].contents).toString("base64")
);
const cards = CARDS.filter((c) => c.kind === "troop" && c.speed > 0).map(
  (c) => c.id,
);
const routes = [
  { from: { x: 4, y: 8 }, to: { x: 4, y: 25 } },
  { from: { x: 9, y: 18 }, to: { x: 4, y: 6 } },
  { from: { x: 0.5, y: 0.6 }, to: { x: 17.5, y: 31.4 } },
  { from: { x: 4, y: 25 }, to: { x: 4, y: 25 } },
];
const modifiers = ["normal", "rage", "slow", "charged"];
const cases = [];
for (const card of cards)
  for (const team of ["red", "blue"])
    for (const [routeIndex, route] of routes.entries())
      for (const modifier of modifiers) {
        const mirror = (p) =>
          team === "red" ? p : { x: 18 - p.x, y: 32 - p.y };
        const from = mirror(route.from),
          to = mirror(route.to);
        const b = new Battle({ seed: 12, ai: false });
        b.spawn(card, team, from.x, from.y);
        const e = b.entities.at(-1);
        Object.assign(e, {
          x: from.x,
          y: from.y,
          move: modifier === "charged" ? 3.2 : 0,
          rage: ["rage", "charged"].includes(modifier)
            ? { remaining: 10 }
            : undefined,
          slow: ["slow", "charged"].includes(modifier)
            ? { remaining: 10 }
            : undefined,
        });
        const target = {
          ...b.entities.find((v) => v.team !== team && v.king),
          ...to,
        };
        const trace = [];
        for (let i = 0; i < 120; i++) {
          b.moveToward(e, target);
          trace.push([e.x, e.y, e.move].map((v) => +v.toFixed(12)));
        }
        const digest = createHash("sha256")
          .update(JSON.stringify(trace))
          .digest("hex");
        cases.push({
          card,
          team,
          route: routeIndex,
          modifier,
          digest,
          last: trace.at(-1),
        });
      }
const output = {
  sourceCommit,
  frames: 120,
  precision: 12,
  cards,
  routes,
  modifiers,
  cases,
};
const path = join(root, "tests/fixtures/movement-step-golden.json");
const text = JSON.stringify(output) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text)
    throw new Error("Movement fixture differs from the original source");
} else writeFileSync(path, text);
console.log(
  JSON.stringify({
    path,
    cards: cards.length,
    cases: cases.length,
    frames: cases.length * 120,
    bytes: JSON.stringify(output).length,
  }),
);
