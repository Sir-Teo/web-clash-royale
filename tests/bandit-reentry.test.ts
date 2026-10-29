import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { banditReentryOpening } from "./fixtures/bandit-reentry-setup";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import golden from "./fixtures/bandit-reentry-rules50-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-recovery-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");

function controlled(version: Replay["version"] = 51, team: Team = "blue", direction = [1, 0]) {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) Object.assign(e, { active: false, radius: 0 });
  (b as any).spawn("bandit", team, 8.25, 8.25, false, 0);
  const bandit = b.entities.at(-1)!;
  Object.assign(bandit, { speed: 0, cooldown: 0, radius: 0.6 });
  (b as any).spawn("knight", team === "blue" ? "red" : "blue",
    8.25 + 5 * direction[0], 8.25 + 5 * direction[1], false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 1000, maxHp: 1000, radius: 0.5 });
  bandit.target = target.id;
  (b as any).acquireTarget = () => target.hp > 0 && b.entities.includes(target) ? target : undefined;
  (b as any).separate = () => {};
  return { b, bandit, target };
}

it("preserves five complete rules-50 games built independently from historical sources", () => {
  expect(golden.sourceCommit).toBe("1e6aca3");
  expect(golden.cases[4].startupZap).toEqual({ chargingUpdates: 43, zapDamage: 192, launchTick: 255 });
  expect(golden.cases[3].dashPoison.duePulses).toBe(1);
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

it("pins immediate reentry to actual post-landing charge and ordinary-reload evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeReentry).toMatchObject({ nextUpdateClockMs: 950, nextUpdateReloadMs: 550 });
});

for (const team of ["blue", "red"] as const) {
  it(`${team} matches all four native two-dash continuations through the second landing`, () => {
    for (const row of native.cases.filter((r: any) => r.fields.scenario === "chain")) {
      const { b, bandit, target } = controlled(51, team, row.fields.direction);
      let hits = 0;
      for (const frame of row.frames.slice(0, 54)) {
        for (const supplied of frame.supplied) if (supplied[0] === "target")
          Object.assign(target, { x: supplied[1] / 1000, y: supplied[2] / 1000 });
        while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
        if (frame.hit) hits++;
        const label = `${team}/${row.fields.direction}/${frame.step}`;
        expect({ x: bandit.x, y: bandit.y }, label).toEqual({ x: frame.xy[0] / 1000, y: frame.xy[1] / 1000 });
        expect(!!bandit.dash, label).toBe(frame.state === 4);
        expect(bandit.dashCharge?.remainingMs ?? (bandit.dash && frame.clockMs ? 1000 : 0), label).toBe(frame.clockMs);
        expect(target.hp, label).toBe(1000 - hits * Math.round(320 * 1.1 ** 2));
      }
      expect(b.audioEvents.filter((e) => e.phase === "dash-start")).toHaveLength(2);
      expect(b.audioEvents.filter((e) => e.phase === "impact-special")).toHaveLength(2);
    }
  });

  it(`${team} legally clears a group during travel and charges the next Knight immediately`, () => {
    const current = banditReentryOpening(51, team), old = banditReentryOpening(50, team);
    expect(current.bandit.dashReentry).toBe(true);
    expect(current.bandit.dashCooldown).toBe(1);
    expect(old.bandit.dashReentry).toBeUndefined();
    for (let i = 0; i < 3; i++) { current.battle.step(); old.battle.step(); }
    expect(current.bandit.dashCharge?.target).toBe(current.knight.id);
    expect(current.bandit.dashCharge?.started).toBe(true);
    expect(current.bandit.dashReentry).toBeUndefined();
    expect(old.bandit.dashCharge).toBeUndefined();
    expect({ x: current.bandit.x, y: current.bandit.y }).toEqual(current.landing);
    expect(current.battle.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "spear-goblins", "knight", "zap"]);
    const replay = new Battle({ replay: current.battle.exportReplay() });
    while (replay.tick < current.battle.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(current.battle));
    expect(replay.audioEvents).toEqual(current.battle.audioEvents);
  });
}

function firstLanding(version: Replay["version"] = 51) {
  const scene = controlled(version);
  while (!scene.bandit.dash && scene.b.tick < 50) scene.b.step();
  while (scene.bandit.dash && scene.b.tick < 80) scene.b.step();
  expect(scene.b.tick).toBe(41);
  return scene;
}

it("keeps ordinary melee recovery identical after committing to a nearby opponent", () => {
  const current = firstLanding(), old = firstLanding(50);
  current.b.step(); old.b.step();
  expect(current.bandit.dashReentry).toBeUndefined();
  for (let step = 0; step < 65; step++) {
    current.b.step(); old.b.step();
    expect({ hp: current.target.hp, cooldown: current.bandit.cooldown,
      pending: current.bandit.pendingAttack }).toEqual({ hp: old.target.hp,
      cooldown: old.bandit.cooldown, pending: old.bandit.pendingAttack });
  }
});

it("waits outside the admission window and retains readiness until a valid distant target exists", () => {
  const { b, bandit, target } = firstLanding();
  target.x = bandit.x + 8;
  for (let step = 0; step < 3; step++) b.step();
  expect(bandit.dashCharge).toBeUndefined();
  expect(bandit.dashReentry).toBe(true);
  target.x = bandit.x + 5;
  for (let step = 0; step < 3; step++) b.step();
  expect(bandit.dashCharge?.target).toBe(target.id);
  expect(bandit.cooldown).toBeGreaterThan(0.7);
});

it("continues to respect attraction and the existing stun pause before a follow-up", () => {
  for (const effect of ["dashAttraction", "stun"] as const) {
    const { b, bandit, target } = firstLanding();
    target.x = bandit.x + 5;
    bandit[effect] = 0.2;
    for (let step = 0; step < 3; step++) b.step();
    expect(bandit.dashCharge).toBeUndefined();
    expect(bandit.dashReentry).toBe(true);
    for (let step = 0; step < 6; step++) b.step();
    expect(bandit.dashCharge).toBeDefined();
    expect(bandit.dashReentry).toBeUndefined();
  }
});

it("keeps the remaining native charge-frame carry when protected travel starts", () => {
  for (const buffs of [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]]) {
    const { b, bandit } = controlled();
    bandit.rage = buffs.includes("Rage") ? { remaining: 10 } : undefined;
    bandit.slow = buffs.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
    while (!bandit.dash && b.tick < 60) b.step();
    expect(bandit.dash).toBeDefined();
    const start = { x: bandit.x, y: bandit.y };
    let nextFrame = b.tick + 1;
    while (Math.floor(nextFrame * 2 / 3) === Math.floor((nextFrame - 1) * 2 / 3)) nextFrame++;
    while (b.tick < nextFrame) {
      b.step();
      expect(bandit.x - start.x).toBeCloseTo(b.tick === nextFrame ? 0.5 : 0);
      expect(bandit.y).toBe(start.y);
    }
  }
});

it("carries readiness through guest rotation and clears it on old-host replacement", () => {
  const current = firstLanding(), old = firstLanding(50);
  const guest = perspective(snapshot(current.b), "red");
  expect(guest.entities.find((e) => e.card === "bandit")).toMatchObject({
    nativeBanditReentry: true, dashReentry: true, x: 18 - current.bandit.x });
  applySnapshot(current.b, snapshot(old.b));
  expect(current.b.entities.find((e) => e.card === "bandit")?.nativeBanditReentry).toBeUndefined();
  expect(current.b.entities.find((e) => e.card === "bandit")?.dashReentry).toBeUndefined();
});

it("gives mirrored Bandits their host's reentry policy", () => {
  for (const version of [50, 51] as const) {
    const { b } = controlled(version);
    b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
    expect(b.play("blue", 0, 4, 22).ok).toBe(true);
    expect(!!b.entities.filter((e) => e.card === "bandit").at(-1)!.nativeBanditReentry).toBe(version === 51);
  }
});

it("records and exactly replays a complete rules-51 match", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 51 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(51);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
