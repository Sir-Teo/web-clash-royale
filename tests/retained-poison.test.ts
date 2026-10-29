import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { healthPackets, poisonDamagePackets } from "../src/game/status-health";
import { createWindupHealth } from "../src/game/windup-health";
import { projectAreaFrames } from "../src/game/tornado-pull";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { retainedPoisonOpening, advanceRetainedPoisonTick } from "./fixtures/retained-poison-setup";
import golden from "./fixtures/retained-poison-rules46-golden.json";

function controlled(version: Replay["version"], team: Team) {
  const b = new Battle({ replay: { ...new Battle({ seed: 91, ai: false }).exportReplay(), version } });
  for (const e of b.entities) e.active = false;
  (b as any).spawn("tesla", team, 4, team === "red" ? 10 : 22, false, 0);
  const tesla = b.entities.at(-1)!;
  tesla.lifetime = undefined;
  return { b, tesla };
}
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(golden.stateFields.map((key) => [key, (b as any)[key]])))).digest("hex");

it("preserves four independently captured complete rules-46 games, including legal hidden-Poison pulses", () => {
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai)
          for (const a of row.replay.actions.filter((a) => a.team === "blue" && a.tick === b.tick))
            expect(b.play("blue", b.players.blue.hand.indexOf(a.card as CardId), a.x, a.y).ok).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(checkpoint.digest);
    }
  }
  expect(golden.cases[3].hiddenPoison).toEqual({ updates: 82, duePulses: 3 });
});

it("binds the new behavior to native retained-Poison evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/poison-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeRetainedTick).toMatchObject({ target: "Tesla", buffManager: "0x25b18e..0x25b216" });
});

for (const version of [46, 47] as const)
  for (const team of ["blue", "red"] as const)
    it(`rules ${version}: ${team} retained Poison agrees with native HP on common 100-ms samples`, () => {
      const trace = JSON.parse(readFileSync("reference/client/buff-lifecycle-native-trace.json", "utf8"));
      const row = trace.cases.find((r: any) => r.fields.damage === 121 && r.fields.level === 0 && r.fields.counter === 15 && r.fields.progress === 600);
      const { b, tesla } = controlled(version, team);
      tesla.hp = tesla.maxHp = 450;
      tesla.burrow = { exposure: 0.25, idle: 0.8, phase: "sinking" };
      tesla.poison = { remaining: 1, elapsed: 0.75 };
      for (const frame of row.frames.filter((f: any) => f.step % 2 === 0)) {
        while (b.tick < frame.step * 1.5) b.step();
        expect(tesla.hp).toBe(version === 47 ? frame.hp : 450);
        expect(tesla.burrow?.phase === "hidden").toBe(frame.hidden);
        expect(!!tesla.poison).toBe(!!frame.buffCount);
        if (tesla.poison) {
          expect(tesla.poison.remaining).toBeCloseTo(frame.remainingMs / 1000, 10);
          expect(tesla.poison.elapsed).toBeCloseTo(frame.counter / 20, 10);
        }
        const hp = tesla.hp;
        if (frame.hidden) (b as any).hurt(tesla, 75);
        expect(tesla.hp).toBe(hp);
      }
      expect(tesla.nativeRetainedPoison).toBe(version === 47 ? true : undefined);
    });

for (const team of ["blue", "red"] as const) {
  it(`${team} legal play applies a retained tick after Tesla burrows and replays it exactly`, () => {
    const old = retainedPoisonOpening(46, team), current = retainedPoisonOpening(47, team);
    expect(current.battle.tick).toBe(old.battle.tick);
    expect(current.tesla.hp).toBe(old.tesla.hp);
    advanceRetainedPoisonTick(old.battle, old.tesla);
    advanceRetainedPoisonTick(current.battle, current.tesla);
    expect(current.battle.tick).toBe(old.battle.tick);
    expect(current.tesla.hp).toBeCloseTo(Math.max(0, old.tesla.hp - 121), 9);
    const replay = new Battle({ replay: current.battle.exportReplay() });
    while (replay.tick < current.battle.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(current.battle));
    expect(replay.audioEvents).toEqual(current.battle.audioEvents);
  });

  it(`${team} hidden Tesla blocks fresh applications and does not refresh retained duration`, () => {
    const { b, tesla } = controlled(47, team), enemy = team === "blue" ? "red" : "blue";
    tesla.active = false;
    b.players[enemy].hand[0] = "poison";
    b.players[enemy].elixir = 10;
    expect(b.play(enemy, 0, tesla.x, tesla.y).ok).toBe(true);
    expect(poisonDamagePackets(tesla, b.areas)).toEqual([]);
    for (let i = 0; i < 30; i++) b.step();
    expect(tesla.hp).toBe(tesla.maxHp);
    expect(tesla.poison).toBeUndefined();
    tesla.poison = { remaining: 0.1, elapsed: 1 - STEP };
    expect(poisonDamagePackets(tesla, b.areas)).toHaveLength(1);
    for (let i = 0; i < 60; i++) b.step();
    expect(tesla.hp).toBe(tesla.maxHp - 121);
    expect(tesla.poison).toBeUndefined();
  });

  it(`${team} health and moving survival projections match a hidden lethal Poison tick`, () => {
    for (const version of [46, 47] as const) {
      const { b, tesla } = controlled(version, team);
      tesla.active = false;
      tesla.hp = 121;
      tesla.poison = { remaining: 0.1, elapsed: 1 - STEP };
      const packets = healthPackets(tesla, [], [], b.entities, STEP);
      expect(packets).toHaveLength(1);
      expect(packets[0].bypassHidden).toBe(version === 47 ? true : undefined);
      const survival = createWindupHealth([], b.entities).survival(tesla, projectAreaFrames(tesla, [], 1), []);
      expect(survival[0].afterAlive).toBe(version === 46);
      b.step();
      expect(tesla.hp > 0).toBe(version === 46);
      expect(b.events.filter((e) => e.type === "death" && e.card === "tesla")).toHaveLength(version === 47 ? 1 : 0);
    }
  });
}

it("does not turn retained damage into shield bypass or dash damage", () => {
  const { b, tesla } = controlled(47, "red");
  tesla.active = false;
  tesla.shield = tesla.maxShield = 1;
  tesla.poison = { remaining: 0.1, elapsed: 1 - STEP };
  const hp = tesla.hp;
  b.step();
  expect(tesla.shield).toBe(0);
  expect(tesla.hp).toBe(hp);
  (b as any).spawn("bandit", "red", 5, 10, false, 0);
  const bandit = b.entities.at(-1)!;
  bandit.active = false;
  bandit.dash = { target: 1, elapsed: 0, remaining: 1 };
  bandit.poison = { remaining: 0.1, elapsed: 1 - STEP };
  const before = bandit.hp;
  b.step();
  expect(bandit.hp).toBe(before);
  expect(bandit.nativeRetainedPoison).toBeUndefined();
});

it("keeps the host's retained-Poison policy through guest rotation and older-host replacement", () => {
  const current = controlled(47, "red"), old = controlled(46, "red");
  const saved = structuredClone(snapshot(current.b));
  expect(perspective(saved, "red").entities.find((e) => e.card === "tesla")?.nativeRetainedPoison).toBe(true);
  applySnapshot(old.b, saved, "red");
  expect(old.b.entities.find((e) => e.card === "tesla")?.nativeRetainedPoison).toBe(true);
  applySnapshot(old.b, snapshot(controlled(46, "red").b), "red");
  expect(old.b.entities.find((e) => e.card === "tesla")?.nativeRetainedPoison).toBeUndefined();
  expect(snapshot(current.b)).toEqual(saved);
});

it("mirrored Tesla inherits the new retained-Poison policy", () => {
  const { b } = controlled(47, "red");
  b.players.red.lastPlayed = "tesla";
  b.players.red.hand[0] = "mirror";
  b.players.red.elixir = 10;
  expect(b.play("red", 0, 14, 10).ok).toBe(true);
  const mirrored = b.entities.filter((e) => e.card === "tesla").at(-1)!;
  expect(mirrored.nativeRetainedPoison).toBe(true);
});

it("records and replays a complete rules-47 match with the retained-Tesla opening", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 47 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).toBeTruthy();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(47);
  expect(digest(replay)).toBe(digest(b));
});
