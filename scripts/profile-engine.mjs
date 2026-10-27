import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const collisionsOnly = process.argv.includes("--collisions");
const reference = process.argv
  .find((arg) => arg.startsWith("--reference="))
  ?.slice(12);
if (reference && !/^[a-f0-9]{7,40}$/.test(reference))
  throw new Error("Reference must be a Git commit hash");
const root = fileURLToPath(new URL("../", import.meta.url));
const digest = (battle) =>
  createHash("sha256").update(JSON.stringify(battle.entities)).digest("hex");

const output = await build({
  entryPoints: ["src/game/engine.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  ...(reference
    ? {
        plugins: [
          {
            name: "reference-engine",
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
        ],
      }
    : {}),
});
const source = Buffer.from(output.outputFiles[0].contents).toString("base64");
const { Battle } = await import(`data:text/javascript;base64,${source}`);

function makeBattle() {
  const battle = new Battle({ seed: 12, ai: false });
  for (const tower of battle.entities) tower.active = false;
  for (let i = 0; i < 8; i++) {
    const team = i % 2 ? "red" : "blue";
    battle.players[team].elixir = 10;
    battle.players[team].hand[0] = "skeleton-army";
    battle.play(team, 0, 2 + (i % 4) * 4, team === "red" ? 10 : 22);
  }
  for (const entity of battle.entities) {
    if (entity.kind !== "troop") continue;
    entity.y = entity.team === "red" ? 14.5 : 17.5;
    entity.deploy = 0;
    entity.age = 3;
    entity.damage = 0;
    entity.speed = 0;
    entity.hp = entity.maxHp = 100000;
  }
  return battle;
}

function measure(steps) {
  const battle = makeBattle();
  const start = performance.now();
  for (let i = 0; i < steps; i++) {
    if (collisionsOnly) {
      battle.separate();
      continue;
    }
    // Exercise the expensive retarget path that dense troop deaths trigger.
    for (const entity of battle.entities) entity.target = null;
    battle.step();
  }
  const elapsed = performance.now() - start;
  return {
    ms: Math.round(elapsed),
    entities: battle.entities.length,
    checksum: battle.entities.reduce(
      (sum, entity) => sum + (entity.target ?? 0),
      0,
    ),
    entitiesSha256: digest(battle),
  };
}

function countDistances(steps) {
  const battle = makeBattle(),
    original = Math.hypot;
  let calls = 0;
  try {
    Math.hypot = (...values) => {
      calls++;
      return original(...values);
    };
    for (let i = 0; i < steps; i++) battle.separate();
  } finally {
    Math.hypot = original;
  }
  return { steps, calls, entitiesSha256: digest(battle) };
}

measure(100);
const samples = Array.from({ length: 5 }, () => measure(300));
console.log(
  JSON.stringify(
    {
      mode: collisionsOnly ? "collisions" : "battle",
      source: reference ?? "worktree",
      steps: 300,
      samples,
      medianMs: samples.map((s) => s.ms).sort((a, b) => a - b)[2],
      // Instrument separately so wrapper overhead is excluded from timing samples.
      ...(collisionsOnly ? { distances: countDistances(300) } : {}),
    },
    null,
    2,
  ),
);
