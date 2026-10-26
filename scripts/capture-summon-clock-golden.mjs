// Complete old matches come from a pinned pre-change engine, never the worktree.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "52d1d8d";
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
      name: "historical-summon-clock",
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
for (const seed of [3111, 4693, 7047]) {
  const initial = new Battle({
    seed,
    ai: false,
    deck: [
      "witch",
      "night-witch",
      "goblin-hut",
      "tombstone",
      "furnace",
      "barbarian-hut",
      "clone",
      "freeze",
    ],
    enemyDeck: [
      "witch",
      "night-witch",
      "goblin-hut",
      "tombstone",
      "furnace",
      "barbarian-hut",
      "rage",
      "freeze",
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
        const support = ["rage", "clone"].includes(card);
        const spell = support || card === "freeze";
        const target =
          spell &&
          battle.entities.find(
            (e) =>
              e.hp > 0 &&
              (support ? e.team === team : e.team !== team) &&
              e.kind === "troop",
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
  const parents = Object.fromEntries(
    [
      "witch",
      "night-witch",
      "goblin-hut",
      "tombstone",
      "furnace",
      "barbarian-hut",
    ].map((id) => [id, battle.actions.filter((a) => a.card === id).length]),
  );
  if (!battle.winner || Object.values(parents).some((n) => n === 0))
    throw new Error("Need complete old matches covering every summoner");
  cases.push({ replay: battle.exportReplay(), parents, checkpoints });
}
const path = new URL(
  "../tests/fixtures/summon-clock-rules20-golden.json",
  import.meta.url,
);
const output =
  JSON.stringify({ sourceCommit, stateFields, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Summon clock fixture differs from historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((sum, c) => sum + c.checkpoints.length, 0),
    ticks: cases.reduce((sum, c) => sum + c.replay.duration, 0),
    parents: cases.map((c) => c.parents),
  }),
);
