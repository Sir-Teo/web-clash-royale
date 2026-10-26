// Complete old matches come from a pinned pre-change engine, never the worktree.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "42e13dc";
const { outputFiles } = await build({
  stdin: {
    contents: 'export { Battle } from "./src/game/engine.ts";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "historical-balloon-bomb",
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
const { Battle } = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].contents).toString("base64")
);
const stateFields = [
  "tick",
  "rulesVersion",
  "entities",
  "projectiles",
  "areas",
  "events",
  "audioEvents",
  "players",
  "winner",
  "reason",
  "actions",
  "randomState",
];
const digest = (battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(stateFields.map((key) => [key, battle[key]])),
      ),
    )
    .digest("hex");
const cases = [];
for (const seed of [1911, 2937, 5471]) {
  const initial = new Battle({
    seed,
    ai: false,
    deck: [
      "balloon",
      "knight",
      "archers",
      "musketeer",
      "fireball",
      "arrows",
      "zap",
      "cannon",
    ],
    enemyDeck: [
      "balloon",
      "minions",
      "cannon",
      "witch",
      "fireball",
      "archers",
      "zap",
      "mini-pekka",
    ],
  });
  const battle = new Battle({
    replay: { ...initial.exportReplay(), duration: 9000 },
  });
  const next = { blue: 0, red: 1 },
    checkpoints = [];
  for (let tick = 0; tick < 9000 && !battle.winner; tick++) {
    if (tick % 105 === 0)
      for (const team of ["blue", "red"]) {
        const slot = next[team] % 4,
          card = battle.players[team].hand[slot];
        const spell = ["fireball", "arrows", "zap"].includes(card);
        const target =
          spell &&
          battle.entities.find(
            (e) => e.hp > 0 && e.team !== team && e.kind === "troop",
          );
        const x = target ? target.x : tick % 210 ? 4 : 14;
        const y = target
          ? target.y
          : spell
            ? team === "blue"
              ? 10
              : 22
            : team === "blue"
              ? 22
              : 10;
        if (battle.play(team, slot, x, y).ok) next[team]++;
      }
    battle.step();
    if (battle.tick % 600 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  const deaths = battle.audioEvents.filter(
    (e) => e.profile === "balloon" && e.phase === "death-spawn",
  ).length;
  if (!battle.winner || !deaths)
    throw new Error("Need complete old matches with Balloon bomb deaths");
  cases.push({ replay: battle.exportReplay(), deaths, checkpoints });
}
const path = new URL(
  "../tests/fixtures/balloon-bomb-rules19-golden.json",
  import.meta.url,
);
const output =
  JSON.stringify({ sourceCommit, stateFields, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Balloon bomb fixture differs from historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((sum, c) => sum + c.checkpoints.length, 0),
    ticks: cases.reduce((sum, c) => sum + c.replay.duration, 0),
    deaths: cases.map((c) => c.deaths),
  }),
);
