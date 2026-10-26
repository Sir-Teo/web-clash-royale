// Complete old matches come from a pinned pre-change engine, never the worktree.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "e33aaf7";
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
      name: "historical-attack-range",
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
const decks = [
  [
    "giant",
    "knight",
    "archers",
    "mini-pekka",
    "musketeer",
    "bomber",
    "fireball",
    "arrows",
  ],
  [
    "inferno-dragon",
    "inferno-tower",
    "giant",
    "ice-wizard",
    "rage",
    "zap",
    "freeze",
    "mirror",
  ],
  [
    "balloon",
    "minions",
    "baby-dragon",
    "lava-hound",
    "rage",
    "zap",
    "freeze",
    "mirror",
  ],
];
const enemies = [
  [
    "hog-rider",
    "bandit",
    "guards",
    "prince",
    "cannon",
    "goblins",
    "zap",
    "arrows",
  ],
  [
    "inferno-tower",
    "inferno-dragon",
    "giant",
    "ice-wizard",
    "rage",
    "freeze",
    "tornado",
    "lightning",
  ],
  [
    "mortar",
    "tesla",
    "princess",
    "cannon",
    "archers",
    "minions",
    "fireball",
    "arrows",
  ],
];
for (const [index, seed] of [3111, 4693, 7047].entries()) {
  const initial = new Battle({
    seed,
    ai: false,
    deck: decks[index],
    enemyDeck: enemies[index],
  });
  const battle = new Battle({
    replay: { ...initial.exportReplay(), duration: 12000 },
  });
  const ai = seed === 4693;
  battle.ai = ai;
  battle.replayActions = null;
  const next = { blue: 0, red: 1 },
    checkpoints = [];
  for (let tick = 0; tick < 12000 && !battle.winner; tick++) {
    if (tick % 105 === 0)
      for (const team of seed === 4693 ? ["blue"] : ["blue", "red"]) {
        const slot = next[team] % 4,
          card = battle.players[team].hand[slot];
        const support = card === "rage";
        const spell = [
          "rage",
          "zap",
          "fireball",
          "lightning",
          "freeze",
          "tornado",
        ].includes(card);
        const target =
          spell &&
          battle.entities.find(
            (e) =>
              e.hp > 0 &&
              e.kind === "troop" &&
              (support ? e.team === team : e.team !== team),
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
  const deployed = [...new Set(battle.actions.map((a) => a.card))].sort();
  if (!battle.winner || deployed.length < 8)
    throw new Error(
      JSON.stringify({
        seed,
        tick: battle.tick,
        winner: battle.winner,
        deployed,
      }),
    );
  cases.push({ replay: battle.exportReplay(), ai, deployed, checkpoints });
}
const path = new URL(
  "../tests/fixtures/attack-range-rules23-golden.json",
  import.meta.url,
);
const output =
  JSON.stringify(
    {
      sourceCommit,
      stateFields,
      cases,
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Attack range fixture differs from historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((sum, c) => sum + c.checkpoints.length, 0),
    ticks: cases.reduce((sum, c) => sum + c.replay.duration, 0),
    deployed: cases.map((c) => c.deployed),
  }),
);
