import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import {
  advanceInfernoClock,
  infernoAttackRate,
  type InfernoCard,
} from "../src/game/inferno";
import { perspective, snapshot } from "../src/network/perspective";
import trace from "../reference/client/inferno-clock-native-trace.json";
import historical from "./fixtures/inferno-clock-rules22-golden.json";

const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          historical.stateFields.map((key) => [key, (battle as any)[key]]),
        ),
      ),
    )
    .digest("hex");

it("pins native clock evidence, source tables and imported deltas", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/inferno-clock-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(trace.sha256);
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
});

describe.each(
  trace.cases.filter(
    (sample) =>
      !sample.buffs.some((buff) => buff === "Freeze" || buff === "ZapFreeze"),
  ),
)("native active Inferno clock $card $buffs", (sample) => {
  it("matches all captured elapsed/stage checkpoints at native and browser steps", () => {
    const raged = sample.buffs.includes("Rage"),
      slowed = sample.buffs.includes("IceWizardSlowDown");
    expect(infernoAttackRate(raged, slowed) * trace.stepMs).toBeCloseTo(
      sample.deltaMs,
      10,
    );
    for (const step of [trace.stepMs / 1000, STEP]) {
      const lock = {
        elapsed: sample.initialElapsedMs / 1000,
        hitTimer: 0.4,
        stage: 0 as 0 | 1 | 2,
      };
      let tick = 0;
      for (const point of sample.checkpoints) {
        const target = (point.tick * trace.stepMs) / 1000 / step;
        if (Math.abs(target - Math.round(target)) > 1e-8) continue;
        while (tick < Math.round(target)) {
          advanceInfernoClock(
            sample.card as InfernoCard,
            lock,
            step,
            raged,
            slowed,
          );
          if (lock.hitTimer <= 1e-8) lock.hitTimer += 0.4;
          tick++;
        }
        expect(lock.elapsed * 1000).toBeCloseTo(point.elapsedMs, 7);
        expect(lock.stage).toBe(point.stage);
      }
    }
  });
});

it.each(trace.boundaries)(
  "uses captured threshold equality: $card $elapsedMs ms",
  (point) => {
    const lock = {
      elapsed: point.elapsedMs / 1000,
      hitTimer: 1,
      stage: 0 as 0 | 1 | 2,
    };
    advanceInfernoClock(point.card as InfernoCard, lock, 0, false, false);
    expect(lock.stage).toBe(point.stage);
  },
);

function scene(card: InfernoCard, team: Team, version: Replay["version"] = 23) {
  const initial = new Battle({ seed: 42, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of battle.entities) entity.active = false;
  (battle as any).spawn(card, team, 4, 20);
  const attacker = battle.entities.at(-1)!;
  (battle as any).spawn("knight", team === "blue" ? "red" : "blue", 4, 18);
  const target = battle.entities.at(-1)!;
  Object.assign(attacker, { deploy: 0 });
  Object.assign(target, { deploy: 0, active: false, hp: 1e6, maxHp: 1e6 });
  return { battle, attacker, target };
}

describe.each(["inferno-tower", "inferno-dragon"] as const)(
  "rules 23 %s combat",
  (card) => {
    it.each(["blue", "red"] as const)(
      "uses the native rate for real pulses and stages (%s)",
      (team) => {
        for (const [buff, firstHit, stage2, stage3] of [
          ["normal", 12, 60, 120],
          ["rage", 9, 45, 90],
          ["slow", 19, 94, 188],
          ["both", 14, 70, 140],
        ] as const) {
          const { battle, attacker, target } = scene(card, team);
          if (buff === "rage" || buff === "both")
            attacker.rage = { remaining: 100 };
          if (buff === "slow" || buff === "both")
            attacker.slow = { remaining: 100 };
          const stages: number[] = [],
            hits: { tick: number; damage: number }[] = [];
          let lastStage = 0;
          for (let tick = 1; tick <= stage3; tick++) {
            const before = target.hp;
            battle.step();
            if (target.hp < before)
              hits.push({ tick, damage: before - target.hp });
            if (attacker.inferno!.stage !== lastStage) {
              stages.push(tick);
              lastStage = attacker.inferno!.stage;
            }
          }
          expect(stages, buff).toEqual([stage2, stage3]);
          expect(hits[0].tick, buff).toBe(firstHit);
          const damages =
            card === "inferno-tower" ? [51, 192, 1024] : [36, 121, 424];
          expect(hits[0].damage).toBe(damages[0]);
          expect(hits.find((hit) => hit.damage === damages[1])?.tick).toBe(
            stage2,
          );
          expect(hits.find((hit) => hit.damage === damages[2])?.tick).toBe(
            stage3,
          );
          const remote = perspective(snapshot(battle), team);
          expect(
            remote.entities.find((e) => e.id === attacker.id)?.inferno,
          ).toEqual(attacker.inferno);
        }
      },
    );

    it("carries progress across buff changes and clears it on interruption", () => {
      const { battle, attacker } = scene(card, "blue");
      for (let i = 0; i < 30; i++) battle.step();
      expect(attacker.inferno!.elapsed).toBeCloseTo(1);
      attacker.rage = { remaining: 100 };
      for (let i = 0; i < 30; i++) battle.step();
      expect(attacker.inferno!.elapsed).toBeCloseTo(2.34);
      attacker.slow = { remaining: 100 };
      for (let i = 0; i < 30; i++) battle.step();
      expect(attacker.inferno!.elapsed).toBeCloseTo(3.2);
      attacker.stun = 0.5;
      battle.step();
      expect(attacker.inferno).toBeUndefined();
      attacker.stun = 0;
      battle.step();
      expect(attacker.inferno!.elapsed).toBeCloseTo(STEP * 0.86);
    });

    it("retains real-time ramp and historical pulse cadence for every earlier rule", () => {
      for (let version = 1; version <= 22; version++) {
        const { battle, attacker } = scene(
          card,
          "blue",
          version as Replay["version"],
        );
        // Version 1 uses the separate pre-origin combat loop and has no Inferno channel.
        if (version === 1) continue;
        attacker.rage = { remaining: 100 };
        attacker.slow = { remaining: 100 };
        for (let i = 0; i < 30; i++) battle.step();
        expect(attacker.inferno!.elapsed).toBeCloseTo(1);
        expect(attacker.inferno!.hitTimer).toBeCloseTo(
          0.4 - (1.35 * 0.65 - 0.8),
        );
      }
    });
  },
);

it("preserves independently captured complete rules-22 matches, including AI decisions", () => {
  expect(historical.sourceCommit).toBe("9b6cb11");
  expect(historical.cases.some((row) => row.ai)).toBe(true);
  for (const row of historical.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (battle as any).ai = true;
      (battle as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (a) => a.team === "blue" && a.tick === battle.tick,
          )) {
            const slot = battle.players.blue.hand.indexOf(action.card as any);
            expect(battle.play("blue", slot, action.x, action.y).ok).toBe(true);
          }
        battle.step();
      }
      expect(digest(battle), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
    expect(battle.winner).toBeTruthy();
  }
});

it("records and replays a complete rules-23 match with identical state and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 23, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter((a) => a.tick === live.tick)) {
      const team = action.team as Team;
      const slot = live.players[team].hand.indexOf(action.card as any);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(23);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
