// Rebuild the independent pre-change engine, never the working tree engine.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "8048bae";
const result = await build({
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
      name: "historical-charge",
      setup(builder) {
        builder.onLoad({ filter: /\/src\/.*\.(?:ts|json)$/ }, (args) => ({
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
const { Battle } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].contents).toString("base64")
);
const deck = [
  "prince",
  "dark-prince",
  "battle-ram",
  "rage",
  "zap",
  "freeze",
  "clone",
  "knight",
];
const enemyDeck = [
  "dark-prince",
  "prince",
  "battle-ram",
  "ice-wizard",
  "lightning",
  "cannon",
  "fireball",
  "arrows",
];
const stateFields = [
  "tick",
  "entities",
  "projectiles",
  "areas",
  "events",
  "audio",
  "players",
  "winner",
  "reason",
  "actions",
  "randomState",
];
const digest = (b) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        tick: b.tick,
        entities: b.entities,
        projectiles: b.projectiles,
        areas: b.areas,
        events: b.events,
        audio: b.audioEvents,
        players: b.players,
        winner: b.winner,
        reason: b.reason,
        actions: b.actions,
        randomState: b.randomState,
      }),
    )
    .digest("hex");
const cases = [];
for (let version = 1; version <= 16; version++) {
  const initial = new Battle({
    seed: 1729 + version,
    ai: false,
    deck,
    enemyDeck,
  });
  const battle = new Battle({
    replay: {
      ...initial.exportReplay(),
      rulesFamily: "origin",
      version,
      duration: 9000,
    },
  });
  const checkpoints = [];
  for (let tick = 0; tick < 9000 && !battle.winner; tick++) {
    if (tick % 81 === 0)
      for (const team of ["blue", "red"]) {
        const slot = (Math.floor(tick / 81) + (team === "red" ? 1 : 0)) % 4;
        const card = battle.players[team].hand[slot];
        const spell = [
          "rage",
          "zap",
          "freeze",
          "clone",
          "lightning",
          "fireball",
          "arrows",
        ].includes(card);
        battle.play(
          team,
          slot,
          tick % 162 === 0 ? 4 : 14,
          spell ? (team === "blue" ? 12 : 20) : team === "blue" ? 22 : 10,
        );
      }
    battle.step();
    if (battle.tick % 300 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  cases.push({ replay: battle.exportReplay(), checkpoints });
}
const path = join(root, "tests/fixtures/charge-legacy-golden.json");
const output =
  JSON.stringify({ sourceCommit, stateFields, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Charge fixture differs from the historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((n, c) => n + c.checkpoints.length, 0),
    ticks: cases.reduce((n, c) => n + c.replay.duration, 0),
  }),
);
