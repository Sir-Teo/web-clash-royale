import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { banditChargeInRange } from "../src/game/bandit-startup";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { banditStartupOpening, finishBanditStartup, zapChargingBandit } from "./fixtures/bandit-startup-setup";
import golden from "./fixtures/bandit-startup-rules49-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-startup-native-trace.json", "utf8"));
const admission = JSON.parse(readFileSync("reference/client/dash-admission-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");

function controlled(version: Replay["version"] = 50, team: Team = "blue", distance = 5) {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) Object.assign(e, { active: false, radius: 0 });
  (b as any).spawn("bandit", team, 8.25, 8.25, false, 0);
  const bandit = b.entities.at(-1)!;
  Object.assign(bandit, { speed: 0, cooldown: 0, radius: 0.6 });
  (b as any).spawn("knight", team === "blue" ? "red" : "blue", 8.25 + distance, 8.25, false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 10000, maxHp: 10000, radius: 0.5 });
  bandit.target = target.id;
  // Match the native capture's existing-valid-target and empty scanner providers.
  (b as any).acquireTarget = () => target.hp > 0 && b.entities.includes(target) ? target : undefined;
  // The native supplied-target capture excludes collision/terrain repair.
  (b as any).separate = () => {};
  return { b, bandit, target };
}

it("preserves five independently built complete rules-49 games", () => {
  expect(golden.sourceCommit).toBe("ddaa62c");
  expect(golden.cases[4].clearedDash).toEqual({ victimDeaths: 1, continuesOnNextStep: 1 });
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai) for (const a of row.replay.actions.filter((a) => a.team === "blue" && a.tick === b.tick))
          expect(b.play("blue", b.players.blue.hand.indexOf(a.card as CardId), a.x, a.y).ok).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(checkpoint.digest);
    }
  }
});

it("pins imported charging constants to complete native startup evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeStartup).toMatchObject({ attackUpdate: "0x25c60c..0x25d068", stepMs: 50, chargeMs: 1000 });
});

it("starts the fixed charge clock on the next world frame at every 30-Hz phase", () => {
  for (let offset = 0; offset < 20; offset++) {
    const { b, bandit } = controlled();
    bandit.cooldown = 10;
    while (b.tick < offset) b.step();
    bandit.cooldown = 0;
    let nativeTick = offset + 1;
    while (Math.floor(nativeTick * 2 / 3) === Math.floor((nativeTick - 1) * 2 / 3)) nativeTick++;
    while (b.tick < nativeTick) {
      b.step();
      expect(bandit.dashCharge?.remainingMs, `offset ${offset}, tick ${b.tick}`)
        .toBe(b.tick === nativeTick ? 950 : 1000);
    }
  }
});

it("matches every captured initial and retained radius window", () => {
  for (const row of [...admission.cases, ...admission.controls]) {
    const f = row.fields;
    const actor = { x: f.origin[0] / 1000, y: f.origin[1] / 1000, radius: 0.6 };
    const target = { x: f.target[0] / 1000, y: f.target[1] / 1000, radius: 0.5,
      ...([4, 6].includes(f.targetState) ? { dash: { target: 0, elapsed: 0, remaining: 1 } } : {}) };
    const radius = target.dash ? 0 : 500;
    const d2 = f.origin.reduce((n: number, v: number, i: number) => n + (v - f.target[i]) ** 2, 0);
    expect(banditChargeInRange(actor, target)).toBe(d2 >= (4600 - radius) ** 2 && d2 <= (6000 + radius) ** 2);
    expect(banditChargeInRange(actor, target, true)).toBe(d2 <= (7000 + radius) ** 2);
  }
});

for (const team of ["blue", "red"] as const) {
  it(`${team} integrates all 74 native supplied startup episodes through the battle`, () => {
    for (const row of [...native.cases, ...native.controls]) {
      const f = row.fields;
      const { b, bandit, target } = controlled(50, team, f.initialDistance / 1000);
      const setDistance = (distance: number) => Object.assign(target, {
        x: 8.25 + distance / 1000 * f.direction[0], y: 8.25 + distance / 1000 * f.direction[1] });
      const setBuffs = (names: string[]) => {
        bandit.rage = names.includes("Rage") ? { remaining: 10 } : undefined;
        bandit.slow = names.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
        bandit.stun = names.some((n) => ["Freeze", "ZapFreeze", "Clone"].includes(n)) ? 10 : 0;
        bandit.dashAttraction = names.includes("Tornado") ? 10 : undefined;
      };
      setDistance(f.initialDistance); setBuffs(f.initialBuffs);
      if (f.initialClockMs) bandit.dashCharge = {
        target: target.id, remainingMs: f.initialClockMs, carry: 0, started: true };
      for (const frame of row.frames) {
        // The capture stops before travel after its final attack-clock clear.
        if (bandit.dash) break;
        for (const change of f.changes.filter((c: any) => c.step === frame.step)) {
          if (change.distance !== undefined) setDistance(change.distance);
          if (change.target === false) b.entities = b.entities.filter((e) => e !== target);
          if (change.buffs) setBuffs(change.buffs);
        }
        while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
        const label = `${team}/${JSON.stringify(f)}/${frame.step}`;
        expect(!!bandit.dash, label).toBe(frame.state === 4);
        expect(bandit.dashCharge?.remainingMs ?? (bandit.dash ? 1000 : 0), label).toBe(frame.clockMs);
        expect({ x: bandit.x, y: bandit.y }, label).toEqual({ x: 8.25, y: 8.25 });
        if (bandit.dash?.goal) expect(bandit.dash.goal, label).toEqual({
          x: (frame.goalTile % 36 + 0.5) * 0.5, y: (Math.trunc(frame.goalTile / 36) + 0.5) * 0.5 });
      }
    }
  });

  it(`${team} legally takes Zap damage while charging and reconstructs the launch from commands`, () => {
    const current = banditStartupOpening(50, team), old = banditStartupOpening(49, team);
    expect(current.bandit.dashCharge?.started).toBe(true);
    expect(current.bandit.dash).toBeUndefined();
    expect(old.bandit.dash).toBeDefined();
    expect(zapChargingBandit(current.battle, current.bandit, current.defender)).toBe(192);
    expect(current.bandit.stun).toBeGreaterThan(0);
    expect(zapChargingBandit(old.battle, old.bandit, old.defender)).toBe(0);
    const clock = current.bandit.dashCharge!.remainingMs;
    current.battle.step();
    expect(current.bandit.dashCharge!.remainingMs).toBe(clock);
    finishBanditStartup(current.battle, current.bandit);
    expect(current.bandit.dash?.goal).toBeDefined();
    const replay = new Battle({ replay: current.battle.exportReplay() });
    while (replay.tick < current.battle.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(current.battle));
    expect(replay.audioEvents).toEqual(current.battle.audioEvents);
    expect(current.battle.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "knight", "zap"]);
  });
}

it("keeps ordinary hits vulnerable until the actual launch and absorbs whole packets with a shield", () => {
  const { b, bandit } = controlled();
  b.step(); b.step();
  expect(bandit.dashCharge).toBeDefined();
  const hp = bandit.hp;
  (b as any).hurt(bandit, 75);
  expect(bandit.hp).toBe(hp - 75);
  bandit.shield = 1;
  (b as any).hurt(bandit, 75);
  expect(bandit.hp).toBe(hp - 75);
  while (!bandit.dash && b.tick < 40) b.step();
  (b as any).hurt(bandit, 75);
  expect(bandit.hp).toBe(hp - 75);
});

it("retains Poison throughout vulnerable charging and protected travel", () => {
  const { b, bandit } = controlled();
  bandit.poison = { remaining: 3, elapsed: 0.95 };
  const hp = bandit.hp;
  b.step(); b.step();
  expect(bandit.hp).toBe(hp - 121);
  while (!bandit.dash && b.tick < 40) b.step();
  expect(bandit.dash).toBeDefined();
  bandit.poison = { remaining: 3, elapsed: 0.99 };
  const travelHp = bandit.hp;
  b.step();
  expect(bandit.hp).toBe(travelHp - 121);
});

it("refreshes source attraction during a real Tornado area and restarts only after its retained buff expires", () => {
  const { b, bandit } = controlled();
  b.step(); b.step();
  const area = { id: 900, card: "tornado", team: "red", x: bandit.x, y: bandit.y,
    radius: 5.5, duration: 0.1, remaining: 0.1, hitAt: 0 } as const;
  b.areas.push({ ...area });
  b.step();
  expect(bandit.dashCharge).toBeUndefined();
  expect(bandit.dashAttraction).toBeGreaterThan(0.4);
  while (b.areas.some((a) => a.id === area.id)) b.step();
  expect(bandit.dashCharge).toBeUndefined();
  while (bandit.dashAttraction) b.step();
  expect(bandit.dashCharge).toBeDefined();
  expect(bandit.dash).toBeUndefined();
});

it("copies charging state through guests and removes it when an old host replaces the snapshot", () => {
  const current = controlled(50, "red"), old = controlled(49, "red");
  current.b.step(); current.b.step(); old.b.step();
  const guest = perspective(snapshot(current.b), "red");
  const charging = guest.entities.find((e) => e.card === "bandit")!;
  expect(charging.nativeBanditStartup).toBe(true);
  expect(charging.dashCharge).toEqual(current.bandit.dashCharge);
  expect(charging.dashCharge).not.toBe(current.bandit.dashCharge);
  charging.dashCharge!.remainingMs = 1;
  expect(current.bandit.dashCharge!.remainingMs).toBe(950);
  applySnapshot(current.b, snapshot(old.b));
  expect(current.b.entities.find((e) => e.card === "bandit")?.nativeBanditStartup).toBeUndefined();
  expect(current.b.entities.find((e) => e.card === "bandit")?.dashCharge).toBeUndefined();
});

it("gives mirrored Bandits the host startup policy", () => {
  const { b } = controlled();
  b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
  expect(b.play("blue", 0, 4, 22).ok).toBe(true);
  expect(b.entities.filter((e) => e.card === "bandit").at(-1)!.nativeBanditStartup).toBe(true);
});

it("records and replays a complete rules-50 game exactly", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 50 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(50);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
