import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { attackClockDelta, attackClockRate } from "../src/game/attack-clock";
import { createKingDefense } from "../src/game/king-defense";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { perspective, snapshot } from "../src/network/perspective";
import native from "../reference/client/first-attacks-native-trace.json";
import historical from "./fixtures/attack-clock-rules27-golden.json";

const cards: Record<string, CardId> = {
  Knight: "knight",
  Archer: "archers",
  Musketeer: "musketeer",
  Giant: "giant",
  HogRider: "hog-rider",
  Balloon: "balloon",
  Prince: "prince",
  InfernoDragon: "inferno-dragon",
  ElectroWizard: "electro-wizard",
  Cannon: "cannon",
  Mortar: "mortar",
  InfernoTower: "inferno-tower",
};
const modes = ["normal", "rage", "slow", "both"] as const;
type Mode = (typeof modes)[number];
function battle(version: Replay["version"] = 28) {
  const initial = new Battle({ seed: 2801, ai: false });
  const result = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of result.entities) entity.active = false;
  return result;
}
function spawn(match: Battle, card: CardId, team: Team, x = 8, y = 20) {
  (match as any).spawn(card, team, x, y);
  const entity = match.entities.at(-1)!;
  Object.assign(entity, {
    deploy: 0,
    age: 3,
    speed: 0,
    active: true,
    lifetime: undefined,
  });
  return entity;
}
function buff(entity: Entity, mode: Mode) {
  if (mode === "rage" || mode === "both") entity.rage = { remaining: 10 };
  if (mode === "slow" || mode === "both") entity.slow = { remaining: 10 };
}

it("pins the native shared-clock evidence and all source/derived hashes", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/attack-clock-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(native.cases).toHaveLength(112);
});

it.each(native.cases.filter((sample) => !sample.loadFirstHit))(
  "resamples the measured native $sourceName clock with $buffs in real combat updates",
  (sample) => {
    const match = battle();
    const actor =
      sample.sourceName.endsWith("Tower") &&
      ["KingTower", "PrincessTower"].includes(sample.sourceName)
        ? match.entities.find(
            (entity) =>
              entity.team === "blue" &&
              !!entity.king === (sample.sourceName === "KingTower"),
          )!
        : spawn(match, cards[sample.sourceName], "blue");
    Object.assign(actor, {
      x: 8,
      y: 20,
      active: true,
      activation: 0,
      cooldown: 1000,
      speed: 0,
    });
    const target = spawn(match, "giant", "red", 8, 18);
    Object.assign(target, { active: false, hp: 1e9, maxHp: 1e9 });
    actor.target = target.id;
    if (actor.card.startsWith("inferno-"))
      actor.inferno = {
        target: target.id,
        elapsed: 1,
        hitTimer: 1000,
        stage: 0,
      };
    if (sample.buffs.includes("Rage")) actor.rage = { remaining: 10 };
    if (sample.buffs.includes("IceWizardSlowDown"))
      actor.slow = { remaining: 10 };
    const [previous, last] = sample.checkpoints.slice(-2);
    for (let i = 0; i < 60; i++) match.step();
    expect(actor.nativeAttackClock).toBe(true);
    expect(1000 - actor.cooldown).toBeCloseTo(
      (last.elapsedMs - previous.elapsedMs) / 1000,
      9,
    );
  },
);

it("preserves historical forecast multiplication order and omits the policy from all earlier bodies", () => {
  expect(attackClockDelta({}, STEP, true, true)).toBe(STEP * 1.35 * 0.65);
  expect(attackClockRate({}, true, true)).toBe(1.35 * 0.65);
  for (let version = 1; version <= 27; version++) {
    const match = battle(version as Replay["version"]);
    spawn(match, "knight", "blue");
    expect(
      match.entities.every(
        (entity) => !Object.hasOwn(entity, "nativeAttackClock"),
      ),
    ).toBe(true);
  }
});

function windup(version: 27 | 28, team: Team, mode: Mode) {
  const match = battle(version);
  const king = match.entities.find(
    (entity) => entity.team === team && entity.king,
  )!;
  king.hp = 40;
  const enemy = team === "blue" ? "red" : "blue";
  const actor = spawn(
    match,
    "knight",
    enemy,
    king.x,
    king.y + (team === "red" ? 1.5 : -1.5),
  );
  Object.assign(actor, {
    target: king.id,
    cooldown: 100,
    pendingAttack: { target: king.id, remaining: 0.9, damage: 100 },
  });
  buff(actor, mode);
  return { match, actor, king, enemy };
}
for (const version of [27, 28] as const)
  for (const team of ["blue", "red"] as const)
    it.each(modes)(
      `matches real fatal windups, direct projections and King forecasts under rules ${version} (${team}, %s)`,
      (mode) => {
        const { match, actor, king, enemy } = windup(version, team, mode);
        const before = JSON.stringify(snapshot(match));
        const expected =
          version === 28
            ? { normal: 27, rage: 21, slow: 43, both: 32 }[mode]
            : { normal: 27, rage: 20, slow: 42, both: 31 }[mode];
        const forecast = createKingDefense(
          team,
          match.entities,
          [],
          [],
          Infinity,
          version,
        );
        expect(forecast.baseline).toBe(expected);
        expect(fatalKingWindups(team, match.entities)[0].step).toBe(expected);
        expect(projectTornadoWindup(actor, king, []).releaseStep).toBe(
          expected,
        );
        expect(JSON.stringify(snapshot(match))).toBe(before);
        for (let tick = 1; tick < expected; tick++) {
          match.step();
          expect(match.winner).toBeNull();
        }
        match.step();
        expect(match.winner).toBe(enemy);
      },
    );

it.each(["blue", "red"] as const)(
  "keeps expiring buffs and actual Freeze cancellation aligned with forecasts (%s)",
  (team) => {
    const expired = windup(28, team, "both");
    expired.actor.rage!.remaining = STEP * 4;
    expired.actor.slow!.remaining = STEP * 13;
    const ending = createKingDefense(
      team,
      expired.match.entities,
      [],
      [],
      Infinity,
      28,
    ).baseline;
    expect(Number.isFinite(ending)).toBe(true);
    for (let tick = 1; tick < ending; tick++) {
      expired.match.step();
      expect(expired.match.winner).toBeNull();
    }
    expired.match.step();
    expect(expired.match.winner).toBe(expired.enemy);
    const frozen = windup(28, team, "both");
    const defense = createKingDefense(
      team,
      frozen.match.entities,
      [],
      [],
      Infinity,
      28,
    );
    expect(defense.evaluate("freeze", frozen.actor).improves).toBe(true);
    frozen.match.players[team].hand[0] = "freeze";
    frozen.match.players[team].elixir = 10;
    expect(frozen.match.play(team, 0, frozen.actor.x, frozen.actor.y).ok).toBe(
      true,
    );
    for (let tick = 0; tick < 60; tick++) frozen.match.step();
    expect(frozen.king.hp).toBe(40);
    expect(frozen.actor.pendingAttack).toBeUndefined();
  },
);

it("retains the policy on real Clones and both guest perspectives", () => {
  const match = battle();
  const actor = spawn(match, "knight", "blue");
  match.players.blue.hand[0] = "clone";
  match.players.blue.elixir = 10;
  expect(match.play("blue", 0, actor.x, actor.y).ok).toBe(true);
  match.step();
  const copy = match.entities.find((entity) => entity.clone)!;
  expect(copy.nativeAttackClock).toBe(true);
  for (const team of ["blue", "red"] as const)
    expect(
      perspective(snapshot(match), team).entities.find(
        (entity) => entity.id === copy.id,
      )!.nativeAttackClock,
    ).toBe(true);
});

const digest = (match: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          historical.stateFields.map((key) => [key, (match as any)[key]]),
        ),
      ),
    )
    .digest("hex");
it("preserves complete pinned rules-27 games with real Rage, slow and combined attacks", () => {
  expect(historical.sourceCommit).toBe("5b5f11f");
  for (const mode of ["rage", "slow", "both"] as const)
    expect(
      historical.cases.some((sample) => sample.buffedActiveUpdates[mode] > 0),
    ).toBe(true);
  for (const row of historical.cases) {
    const match = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (match as any).ai = true;
      (match as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (match.tick < checkpoint.tick && !match.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (entry) => entry.team === "blue" && entry.tick === match.tick,
          ))
            expect(
              match.play(
                "blue",
                match.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
        match.step();
      }
      expect(digest(match), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
    expect(match.winner).toBeTruthy();
  }
});

it("records and replays a complete current buffed match with identical world and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 28, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let buffedUpdates = 0;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (entry) => entry.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    buffedUpdates += Number(
      live.entities.some(
        (entity) => entity.pendingAttack && (entity.rage || entity.slow),
      ),
    );
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(buffedUpdates).toBeGreaterThan(0);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(28);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
