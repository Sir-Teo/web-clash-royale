// Rebuild the independent pre-change engine, never the working tree engine.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const presentation = process.argv.includes("--presentation");
const formation = process.argv.includes("--formation");
const sourceCommit = formation
  ? "f2413c5"
  : presentation
    ? "2c79362"
    : "ba6d20c";
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
      name: "historical-deployment",
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
  "bats",
  "elite-barbarians",
  "guards",
  "ice-spirit",
  "fire-spirits",
  "furnace",
  "barbarian-hut",
  "night-witch",
];
const enemyDeck = [
  "guards",
  "furnace",
  "elite-barbarians",
  "fire-spirits",
  "bats",
  "barbarian-hut",
  "ice-spirit",
  "rage",
];
if (presentation) {
  deck.splice(
    0,
    deck.length,
    "three-musketeers",
    "archers",
    "minion-horde",
    "skeleton-army",
    "spear-goblins",
    "goblins",
    "guards",
    "bats",
  );
  enemyDeck.splice(
    0,
    enemyDeck.length,
    "fire-spirits",
    "elite-barbarians",
    "minions",
    "knight",
    "mirror",
    "clone",
    "rage",
    "archers",
  );
}
if (formation) {
  deck.splice(
    0,
    deck.length,
    "three-musketeers",
    "archers",
    "minion-horde",
    "skeletons",
    "goblins",
    "spear-goblins",
    "guards",
    "bats",
  );
  enemyDeck.splice(
    0,
    enemyDeck.length,
    "barbarians",
    "fire-spirits",
    "elite-barbarians",
    "minions",
    "knight",
    "mirror",
    "clone",
    "rage",
  );
}
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
const versions = formation
  ? [18, 18, 18]
  : presentation
    ? [18]
    : Array.from({ length: 17 }, (_, i) => i + 1);
for (const [caseIndex, version] of versions.entries()) {
  const initial = new Battle({
    seed: 1729 + version + (formation ? caseIndex * 77 : 0),
    ai: false,
    deck,
    enemyDeck,
  });
  const battle = new Battle({
    replay: {
      ...initial.exportReplay(),
      rulesFamily: "origin",
      version,
      duration: 12000,
    },
  });
  const checkpoints = [];
  const nextSlot = { blue: 0, red: 1 };
  for (let tick = 0; tick < 12000 && !battle.winner; tick++) {
    if (tick % 81 === 0)
      for (const team of ["blue", "red"]) {
        const slot = formation
          ? nextSlot[team] % 4
          : (Math.floor(tick / 81) + (team === "red" ? 1 : 0)) % 4;
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
        const result = battle.play(
          team,
          slot,
          tick % 162 === 0 ? 4 : 14,
          spell ? (team === "blue" ? 12 : 20) : team === "blue" ? 22 : 10,
        );
        if (formation && result.ok) nextSlot[team]++;
      }
    battle.step();
    if (battle.tick % 300 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  cases.push({ replay: battle.exportReplay(), checkpoints });
}
const path = join(
  root,
  formation
    ? "tests/fixtures/formation-legacy-golden.json"
    : presentation
      ? "tests/fixtures/deployment-presentation-golden.json"
      : "tests/fixtures/deployment-legacy-golden.json",
);
const output =
  JSON.stringify({ sourceCommit, stateFields, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Deployment fixture differs from the historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((n, c) => n + c.checkpoints.length, 0),
    ticks: cases.reduce((n, c) => n + c.replay.duration, 0),
  }),
);
