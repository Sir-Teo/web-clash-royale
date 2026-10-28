// Complete rules-47 games are built from this commit, never current sources.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceCommit = "a87e670";
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
      name: "historical-bandit-dash",
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
  "nativeTowerLayout",
  "nativeArmyFormation",
  "nativeGroupFormation",
  "nativeGroundDeployment",
  "nativeArmyViewMirrored",
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
const decks = [
  [
    "giant",
    "valkyrie",
    "bomber",
    "bowler",
    "rage",
    "ice-wizard",
    "poison",
    "goblin-barrel",
  ],
  [
    "sparky",
    "bomb-tower",
    "giant",
    "executioner",
    "rage",
    "ice-wizard",
    "freeze",
    "mirror",
  ],
  [
    "balloon",
    "minions",
    "princess",
    "lava-hound",
    "rage",
    "ice-wizard",
    "goblin-barrel",
    "mirror",
  ],
];
const enemies = [
  [
    "hog-rider",
    "bandit",
    "tesla",
    "prince",
    "mortar",
    "ice-wizard",
    "rage",
    "zap",
  ],
  [
    "cannon",
    "mortar",
    "giant",
    "electro-wizard",
    "rage",
    "ice-wizard",
    "poison",
    "lightning",
  ],
  [
    "mortar",
    "tesla",
    "princess",
    "cannon",
    "ice-wizard",
    "minions",
    "rage",
    "arrows",
  ],
];
decks.push(["bandit", "knight", "cannon", "archers", "rage", "ice-wizard", "zap", "skeletons"]);
enemies.push(["poison", "knight", "cannon", "archers", "rage", "ice-wizard", "zap", "skeletons"]);
const cases = [];
for (const [index, seed] of [3111, 4693, 7047, 2].entries()) {
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
  const poisonedUpdates = { tower: 0, troop: 0 };
  const dashPoison = { updates: 0, duePulses: 0 };
  const buffedActiveUpdates = { rage: 0, slow: 0, both: 0 };
  const barrelLandings = new Set();
  const scannedCards = new Set();
  const towerDeaths = new Set();
  for (let tick = 0; tick < 12000 && !battle.winner; tick++) {
    if (index === 3 && tick === 180) {
      if (!battle.play("blue", battle.players.blue.hand.indexOf("bandit"), 4, 19).ok ||
          !battle.play("red", battle.players.red.hand.indexOf("knight"), 4, 13).ok)
        throw new Error("Dash opening deployment failed");
    }
    if (index === 3 && tick === 183 &&
        !battle.play("red", battle.players.red.hand.indexOf("poison"), 4, 19).ok)
      throw new Error("Dash opening Poison failed");
    if ((index !== 3 || tick >= 450) && tick % 105 === 0)
      for (const team of ai ? ["blue"] : ["blue", "red"]) {
        const slot = next[team] % 4,
          card = battle.players[team].hand[slot];
        const support = card === "rage" || card === "goblin-barrel";
        const spell = [
          "goblin-barrel",
          "rage",
          "zap",
          "lightning",
          "freeze",
          "tornado",
          "poison",
          "arrows",
          "rocket",
          "fireball",
        ].includes(card);
        const crownSpell =
          index === 3 &&
          ["fireball", "arrows", "rocket", "lightning", "zap", "poison"].includes(card);
        const crownTarget =
          crownSpell &&
          battle.entities.find(
            (e) => e.team !== team && e.kind === "tower" && e.hp > 0 && !e.king,
          );
        const exposedTesla = card === "poison" && battle.entities.find((e) =>
          e.team !== team && e.card === "tesla" && e.hp > 0 && e.deploy <= 0 && e.burrow?.phase !== "hidden");
        const target =
          exposedTesla || crownTarget ||
          (spell &&
            battle.entities.find(
              (e) =>
                e.hp > 0 &&
                e.kind === "troop" &&
                (support ? e.team === team : e.team !== team),
            ));
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
    for (const body of battle.entities) {
      if (body.hp <= 0 || body.card !== "bandit" || !body.dash || !body.poison) continue;
      dashPoison.updates++;
      if (body.poison.elapsed + 1 / 30 + 1e-8 >= 1) dashPoison.duePulses++;
    }
    battle.step();
    for (const event of battle.events) {
      if (event.type === "death" && event.card === "tower")
        towerDeaths.add(event.id);
      if (event.type === "hit" && event.card === "goblin-barrel")
        barrelLandings.add(event.id);
    }
    for (const body of battle.entities) {
      if (body.poison) poisonedUpdates[body.kind === "tower" ? "tower" : "troop"]++;
      if (body.card !== "tower" && body.target !== null)
        scannedCards.add(body.card);
      if (
        body.hp <= 0 ||
        body.deploy > 0 ||
        (!body.pendingAttack && body.attack <= 0) ||
        body.card.startsWith("inferno-")
      )
        continue;
      const mode = body.rage
        ? body.slow
          ? "both"
          : "rage"
        : body.slow
          ? "slow"
          : undefined;
      if (mode) buffedActiveUpdates[mode]++;
    }
    if (battle.tick % 600 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  const deployed = [...new Set(battle.actions.map((a) => a.card))].sort();
  if (
    !battle.winner ||
    deployed.length < 8 ||
    (index !== 3 && !Object.values(buffedActiveUpdates).some(Boolean))
  )
    throw new Error(
      JSON.stringify({
        seed,
        tick: battle.tick,
        winner: battle.winner,
        deployed,
        buffedActiveUpdates,
      }),
    );
  cases.push({
    replay: battle.exportReplay(),
    ai,
    deployed,
    poisonedUpdates,
    dashPoison,
    buffedActiveUpdates,
    barrelLandings: barrelLandings.size,
    scannedCards: [...scannedCards].sort(),
    towerDeaths: towerDeaths.size,
    checkpoints,
  });
}
if (!cases.some((sample) => sample.deployed.includes("sparky")))
  throw new Error("No historical Sparky deployments");
if (!cases.some((sample) => sample.barrelLandings > 0))
  throw new Error("No historical Goblin Barrel landings");
for (const mode of ["rage", "slow", "both"])
  if (!cases.some((sample) => sample.buffedActiveUpdates[mode] > 0))
    throw new Error(`No historical ${mode} attacks`);
for (const kind of ["tower", "troop"])
  if (!cases.some((c) => c.poisonedUpdates[kind] > 0))
    throw new Error(`No historical Poison ${kind} updates`);
if (!cases.some((c) => c.dashPoison.duePulses > 0))
  throw new Error("No historical dash Poison pulses: " + JSON.stringify(cases.map((c) => c.dashPoison)));
const path = new URL(
  "../tests/fixtures/bandit-dash-rules47-golden.json",
  import.meta.url,
);
const output =
  JSON.stringify({ sourceCommit, stateFields, cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("Bandit dash fixture differs from historical engine");
} else writeFileSync(path, output);
console.log(
  JSON.stringify({
    cases: cases.length,
    checkpoints: cases.reduce((sum, c) => sum + c.checkpoints.length, 0),
    ticks: cases.reduce((sum, c) => sum + c.replay.duration, 0),
    buffedActiveUpdates: cases.map((c) => c.buffedActiveUpdates),
    poisonedUpdates: cases.map((c) => c.poisonedUpdates),
    dashPoison: cases.map((c) => c.dashPoison),
  }),
);
