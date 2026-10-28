import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { projectTornadoWindup, resolveWindup } from "../src/game/tornado-pull";
import { fatalKingWindups } from "../src/game/king-spell-race";
import { banditStartupOpening, finishBanditStartup } from "./fixtures/bandit-startup-setup";
import golden from "./fixtures/bandit-recovery-rules51-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-recovery-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");

function controlled(version: Replay["version"] = 52, team: Team = "blue", direction = [1, 0]) {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) Object.assign(e, { active: false, radius: 0 });
  (b as any).spawn("bandit", team, 8.25, 8.25, false, 0);
  const bandit = b.entities.at(-1)!;
  Object.assign(bandit, { speed: 0, cooldown: 0, radius: 0.6 });
  (b as any).spawn("knight", team === "blue" ? "red" : "blue",
    8.25 + 5 * direction[0], 8.25 + 5 * direction[1], false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 10000, maxHp: 10000, radius: 0.5 });
  bandit.target = target.id;
  (b as any).acquireTarget = () => target.hp > 0 && b.entities.includes(target) ? target : undefined;
  (b as any).separate = () => {};
  return { b, bandit, target };
}
function landed(version: Replay["version"] = 52) {
  const scene = controlled(version);
  while (!scene.bandit.dash && scene.b.tick < 50) scene.b.step();
  while (scene.bandit.dash && scene.b.tick < 80) scene.b.step();
  return scene;
}

it("preserves six complete rules-51 games from an independently built historical engine", () => {
  expect(golden.sourceCommit).toBe("47d018d");
  expect(golden.cases[5].followUp).toEqual({ firstLandingTick: 252, readyUpdates: 2, nextChargeTick: 253, nextLaunchTick: 282 });
  expect(golden.cases[4].startupZap.zapDamage).toBe(192);
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

it("pins first recovery to the imported native request witnesses", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeRecovery).toMatchObject({ loadTimeMs: 600,
    firstRequestAfterHitUpdates: 19, firstRequestAfterMissUpdates: 8 });
});

for (const team of ["blue", "red"] as const) {
  it(`${team} matches every native first ordinary request after hit, miss, chain and supplied reload/buffs`, () => {
    for (const row of [...native.cases, ...native.controls]) {
      const { b, bandit, target } = controlled(52, team, row.fields.direction);
      const request = row.frames.find((f: any) => f.ordinaryRequests.length).step;
      let landedHits = 0;
      for (const frame of row.frames.slice(0, request)) {
        for (const supplied of frame.supplied) {
          if (supplied[0] === "target") Object.assign(target, { x: supplied[1] / 1000, y: supplied[2] / 1000 });
          if (supplied[0] === "reloadMs") bandit.banditRecovery!.reloadMs = supplied[1];
          if (supplied[0] === "buffs") {
            bandit.rage = supplied.includes("Rage") ? { remaining: 10 } : undefined;
            bandit.slow = supplied.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
          }
        }
        while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
        if (frame.hit) landedHits++;
        const label = `${team}/${JSON.stringify(row.fields)}/${frame.step}`;
        const recovery = bandit.pendingAttack?.recovery ?? bandit.banditRecovery;
        expect({ x: bandit.x, y: bandit.y }, label).toEqual({ x: frame.xy[0] / 1000, y: frame.xy[1] / 1000 });
        if (recovery) expect({ elapsed: recovery.elapsedMs, reload: recovery.reloadMs }, label)
          .toEqual({ elapsed: frame.elapsedMs, reload: frame.reloadMs });
        const ordinaryDamage = frame.step === request ? bandit.damage : 0;
        expect(target.hp, label).toBe(10000 - landedHits * Math.round(320 * 1.1 ** 2) - ordinaryDamage);
      }
      expect(bandit.pendingAttack?.recovery).toBeUndefined();
      expect(bandit.banditRecovery).toBeUndefined();
      expect(b.audioEvents.filter((e) => e.phase === "attack")).toHaveLength(1);
    }
  });

  it(`${team} shortens the first melee recovery in a legal match and replays it exactly`, () => {
    const scene = banditStartupOpening(52, team);
    finishBanditStartup(scene.battle, scene.bandit);
    while (scene.bandit.dash) scene.battle.step();
    const landingTick = scene.battle.tick;
    const target = scene.battle.entities.find((e) => e.card === "knight")!;
    const landingHp = target.hp;
    while (target.hp === landingHp && scene.battle.tick < landingTick + 60) scene.battle.step();
    expect(scene.battle.tick - landingTick).toBeLessThan(35);
    const replay = new Battle({ replay: scene.battle.exportReplay() });
    while (replay.tick < scene.battle.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(scene.battle));
    expect(replay.audioEvents).toEqual(scene.battle.audioEvents);
    expect(scene.battle.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "knight"]);
  });
}

it("predicts the exact release frame across modifier expiry without changing the live clock", () => {
  for (const [rage, slow] of [[0, 0], [0.21, 0], [0, 0.21], [0.21, 0.37], [10, 10]]) {
    const { b, bandit, target } = landed();
    bandit.rage = rage ? { remaining: rage } : undefined;
    bandit.slow = slow ? { remaining: slow } : undefined;
    b.step();
    const before = JSON.stringify(bandit.pendingAttack);
    const projection = projectTornadoWindup(bandit, target, []);
    expect(JSON.stringify(bandit.pendingAttack)).toBe(before);
    const start = b.tick, hp = target.hp;
    while (target.hp === hp && b.tick < start + 60) b.step();
    expect(b.tick - start, `${rage}/${slow}`).toBe(projection.releaseStep);
  }
});

it("shares the release deadline with fatal King forecasts", () => {
  for (const [rage, slow] of [[0, 0], [0.21, 0], [0, 10], [10, 10]]) {
    const { b, bandit, target } = landed();
    Object.assign(target, { card: "tower", kind: "tower", king: true, hp: bandit.damage });
    bandit.rage = rage ? { remaining: rage } : undefined;
    bandit.slow = slow ? { remaining: slow } : undefined;
    b.step();
    const forecast = fatalKingWindups(target.team, [bandit, target]);
    expect(forecast).toHaveLength(1);
    const start = b.tick;
    while (target.hp > 0 && b.tick < start + 60) b.step();
    expect(b.tick - start).toBe(forecast[0].step);
  }
});

it("retains existing cancellation and projectile ordering around the first recovery", () => {
  for (const cancel of ["stun", "range", "dead"] as const) {
    const { b, bandit, target } = landed(); b.step();
    expect(bandit.pendingAttack?.recovery).toBeDefined();
    if (cancel === "stun") bandit.stun = 0.2;
    else if (cancel === "range") target.x = bandit.x + 3;
    else target.hp = 0;
    b.step();
    expect(bandit.pendingAttack?.recovery).toBeUndefined();
    expect(bandit.banditRecovery).toBeUndefined();
  }
  const { b, bandit, target } = landed(); b.step();
  const count = projectTornadoWindup(bandit, target, []).releaseStep!;
  const frames = Array.from({ length: count }, () => ({ position: { x: bandit.x, y: bandit.y }, stun: 0, boost: 0, slow: 0 }));
  const statuses = frames.map(() => ({ beforeAlive: true, beforeInterrupt: false, afterAlive: true, interrupt: false, slow: 0 }));
  statuses[count - 1].interrupt = true;
  expect(resolveWindup(bandit, target, frames, statuses).releaseStep).toBe(count);
  statuses[count - 1].beforeInterrupt = true;
  expect(resolveWindup(bandit, target, frames, statuses).cancelledStep).toBe(count);
});

it("decrements idle reload without starting a request while no ordinary target exists", () => {
  const { b, bandit, target } = landed();
  target.x = bandit.x + 3;
  for (let i = 0; i < 9; i++) b.step();
  expect(bandit.banditRecovery).toMatchObject({ elapsedMs: 0, reloadMs: 300 });
  target.x = bandit.x + 1.5;
  const start = b.tick, hp = target.hp;
  while (target.hp === hp && b.tick < start + 60) b.step();
  expect(b.tick - start).toBe(19);
});

it("copies recovery clocks for guests and clears them on old-host replacement", () => {
  const current = landed(), old = landed(51);
  const guest = perspective(snapshot(current.b), "red").entities.find((e) => e.card === "bandit")!;
  expect(guest.banditRecovery).toEqual(current.bandit.banditRecovery);
  expect(guest.banditRecovery).not.toBe(current.bandit.banditRecovery);
  current.b.step();
  const active = perspective(snapshot(current.b), "red").entities.find((e) => e.card === "bandit")!;
  expect(active.pendingAttack?.recovery).toEqual(current.bandit.pendingAttack?.recovery);
  expect(active.pendingAttack?.recovery).not.toBe(current.bandit.pendingAttack?.recovery);
  applySnapshot(current.b, snapshot(old.b), "blue");
  expect(current.b.entities.find((e) => e.card === "bandit")?.nativeBanditRecovery).toBeUndefined();
});

it("applies the host recovery policy to mirrored Bandits", () => {
  for (const version of [51, 52] as const) {
    const { b } = controlled(version);
    b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
    expect(b.play("blue", 0, 4, 22).ok).toBe(true);
    expect(!!b.entities.filter((e) => e.card === "bandit").at(-1)!.nativeBanditRecovery).toBe(version === 52);
  }
});

it("keeps ordinary attacks before a dash on the shared combat path", () => {
  const current = controlled(), old = controlled(51);
  for (const scene of [current, old]) scene.target.x = scene.bandit.x + 1.5;
  for (let i = 0; i < 120; i++) {
    current.b.step(); old.b.step();
    expect({ hp: current.target.hp, cooldown: current.bandit.cooldown, attack: current.bandit.attack,
      pending: current.bandit.pendingAttack }).toEqual({ hp: old.target.hp, cooldown: old.bandit.cooldown,
        attack: old.bandit.attack, pending: old.bandit.pendingAttack });
    expect(current.bandit.banditRecovery).toBeUndefined();
  }
});

it("returns subsequent ordinary hits to the shared attack cadence", () => {
  const { b, bandit, target } = landed();
  const ticks: number[] = [];
  for (let i = 0; i < 150 && ticks.length < 4; i++) {
    const hp = target.hp; b.step();
    if (target.hp < hp) ticks.push(b.tick);
    if (ticks.length) {
      expect(bandit.banditRecovery).toBeUndefined();
      expect(bandit.pendingAttack?.recovery).toBeUndefined();
    }
  }
  expect(ticks).toHaveLength(4);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBe(30);
});

it("exactly replays a complete rules-52 match", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 52 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(52);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
