import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { banditDashSpeed } from "../src/game/bandit-dash";
import { healthPackets } from "../src/game/status-health";
import { createWindupHealth } from "../src/game/windup-health";
import { projectAreaFrames } from "../src/game/tornado-pull";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { banditDashOpening, dashDistance } from "./fixtures/bandit-dash-setup";
import golden from "./fixtures/bandit-dash-rules47-golden.json";

const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(golden.stateFields.map((key) => [key, (b as any)[key]])))).digest("hex");
function controlled(version: Replay["version"], team: Team = "blue") {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) e.active = false;
  (b as any).spawn("bandit", team, 8.25, 14, false, 0);
  const bandit = b.entities.at(-1)!;
  (b as any).spawn("knight", team === "blue" ? "red" : "blue", 14.25, 14, false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 10000, maxHp: 10000 });
  bandit.hp = bandit.maxHp = 750;
  bandit.dash = { target: target.id, elapsed: 0, remaining: 2 };
  return { b, bandit, target };
}

it("preserves four independently built complete rules-47 games with a due mid-dash Poison tick", () => {
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
  expect(golden.cases[3].dashPoison).toEqual({ updates: 14, duePulses: 1 });
});

it("pins imported travel and retained-damage policy to native evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeDash).toMatchObject({ stepMs: 50, sourceUnitsPerStep: 500, unitsPerTile: 1000 });
  expect(banditDashSpeed({ nativeBanditDash: true })).toBe(10);
  expect(banditDashSpeed({})).toBe(500 / 60);
});

for (const version of [47, 48] as const)
  for (const team of ["blue", "red"] as const) {
    it(`rules ${version}: ${team} dash and retained HP agree at common native 100-ms samples`, () => {
      const native = JSON.parse(readFileSync("reference/client/dash-lifecycle-native-trace.json", "utf8"));
      const row = native.cases.find((r: any) => r.fields.direction[0] === 1 && r.fields.counter === 12 && r.fields.damage === 121);
      const { b, bandit } = controlled(version, team);
      bandit.poison = { remaining: 2, elapsed: 0.6 };
      for (const f of row.frames.filter((f: any) => f.step % 2 === 0)) {
        while (b.tick < f.step * 1.5) b.step();
        expect(bandit.x - 8.25).toBeCloseTo((f.xy[0] - 8250) / 1000 * (version === 48 ? 1 : 5 / 6), 10);
        expect(bandit.hp).toBe(version === 48 ? f.hp : 750);
        expect(bandit.poison!.elapsed).toBeCloseTo(f.counter * 0.05, 10);
        expect(bandit.dash).toBeDefined();
      }
      expect(bandit.nativeBanditDash).toBe(version === 48 ? true : undefined);
    });

    it(`rules ${version}: ${team} legal opening ticks Poison while the faster dash remains replayable`, () => {
      const { battle: b, bandit } = banditDashOpening(version, team);
      const before = { x: bandit.x, y: bandit.y, hp: bandit.hp };
      b.step();
      expect(bandit.dash).toBeDefined();
      expect(bandit.hp).toBe(before.hp - (version === 48 ? 121 : 0));
      expect(dashDistance(before, bandit)).toBeCloseTo((version === 48 ? 10 : 500 / 60) * STEP, 10);
      expect(b.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "knight", "poison"]);
      const replay = new Battle({ replay: b.exportReplay() });
      while (replay.tick < b.tick) replay.step();
      expect(snapshot(replay)).toEqual(snapshot(b));
      expect(replay.audioEvents).toEqual(b.audioEvents);
    });
  }

for (const version of [47, 48] as const)
  it(`rules ${version}: static and moving health forecasts agree on lethal Poison during a dash`, () => {
    const { b, bandit, target } = controlled(version);
    bandit.hp = 121;
    bandit.poison = { remaining: 0.1, elapsed: 1 - STEP };
    const packets = healthPackets(bandit, [], [], b.entities, STEP);
    expect(packets).toHaveLength(1);
    expect(packets[0].bypassDash).toBe(version === 48 ? true : undefined);
    expect(packets[0].bypassHidden).toBeUndefined();
    const forecast = createWindupHealth([], b.entities).survival(bandit, projectAreaFrames(bandit, [], 1), []);
    expect(forecast[0].afterAlive).toBe(version === 47);
    b.step();
    expect(bandit.hp > 0).toBe(version === 47);
    expect(target.hp).toBe(10000);
    expect(b.events.filter((e) => e.type === "death" && e.card === "bandit")).toHaveLength(version === 48 ? 1 : 0);
    expect(b.audioEvents.filter((e) => e.profile === "bandit" && e.phase === "impact-special")).toHaveLength(0);
  });

it("keeps ordinary hits blocked and preserves whole-packet shield absorption", () => {
  const { b, bandit } = controlled(48);
  bandit.shield = bandit.maxShield = 1;
  bandit.poison = { remaining: 0.1, elapsed: 1 - STEP };
  (b as any).hurt(bandit, 1000);
  expect(bandit.hp).toBe(750);
  expect(bandit.shield).toBe(1);
  b.step();
  expect(bandit.hp).toBe(750);
  expect(bandit.shield).toBe(0);
  expect(bandit.dash).toBeDefined();
});

it("retains native travel and tick policies through guest rotation and old-host replacement", () => {
  const current = controlled(48, "red"), old = controlled(47, "red");
  const saved = structuredClone(snapshot(current.b));
  const guest = perspective(saved, "red").entities.find((e) => e.card === "bandit")!;
  expect(guest.nativeBanditDash).toBe(true);
  expect(banditDashSpeed(guest)).toBe(10);
  applySnapshot(old.b, saved, "red");
  expect(old.b.entities.find((e) => e.card === "bandit")?.nativeBanditDash).toBe(true);
  applySnapshot(old.b, snapshot(controlled(47, "red").b), "red");
  expect(old.b.entities.find((e) => e.card === "bandit")?.nativeBanditDash).toBeUndefined();
  expect(snapshot(current.b)).toEqual(saved);
});

it("gives mirrored Bandits the current host's travel and retained-tick policy", () => {
  const { b } = controlled(48, "red");
  b.players.red.lastPlayed = "bandit";
  b.players.red.hand[0] = "mirror";
  b.players.red.elixir = 10;
  expect(b.play("red", 0, 14, 10).ok).toBe(true);
  const mirrored = b.entities.filter((e) => e.card === "bandit").at(-1)!;
  expect(mirrored.nativeBanditDash).toBe(true);
  expect(banditDashSpeed(mirrored)).toBe(10);
});

it("records and exactly replays a complete current-rules match from the legal dash opening", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 48 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(48);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
