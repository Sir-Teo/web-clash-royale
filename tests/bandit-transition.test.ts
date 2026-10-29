import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { banditRecoveryRemaining } from "../src/game/bandit-recovery";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { banditTransitionOpening, pullPreparingBandit } from "./fixtures/bandit-transition-setup";
import golden from "./fixtures/bandit-transition-rules53-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-transition-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");

function controlled(version: Replay["version"] = 54, team: Team = "blue", direction = [1, 0]) {
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
function firstOrdinary(version: Replay["version"] = 54) {
  const scene = controlled(version);
  while (scene.target.hp > 10000 - Math.round(320 * 1.1 ** 2) - scene.bandit.damage && scene.b.tick < 100) scene.b.step();
  expect(scene.b.tick).toBe(69);
  return scene;
}

it("preserves seven complete rules-53 games independently built from the saved historical engine", () => {
  expect(golden.sourceCommit).toBe("b8392a8");
  expect(golden.cases[5].followUp).toEqual({ firstLandingTick: 252, readyUpdates: 2, nextChargeTick: 253, nextLaunchTick: 282 });
  expect(golden.cases[4].startupZap.zapDamage).toBe(192);
  expect(golden.cases[3].dashPoison.duePulses).toBe(1);
  expect(golden.cases[6].ordinaryPull).toMatchObject({ landingTick: 249, castTick: 266, comparisonTick: 278, cancelledUpdates: 12, hitsAtComparison: 0 });
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
}, 20000);

for (const team of ["blue", "red"] as const) {
  it(`${team} reproduces all complete native ordinary-to-dash episodes and raw phase boundaries`, () => {
    let frames = 0, ordinaryRequests = 0;
    for (const row of [...native.cases, ...native.controls]) {
      const { b, bandit, target } = controlled(54, team, row.fields.direction);
      if (row.fields.scenario === "phase-boundary") {
        const clock = { elapsedMs: row.fields.initialElapsedMs, reloadMs: row.fields.initialReloadMs, carry: 0 };
        if (clock.elapsedMs % 1000 >= 600) bandit.pendingAttack = {
          target: target.id, damage: bandit.damage, remaining: banditRecoveryRemaining(clock, 1),
          recovery: { ...clock, animating: true } };
        else bandit.banditRecovery = clock;
      }
      let hits = 0, ordinary = 0;
      for (const frame of row.frames) {
        for (const supplied of frame.supplied) {
          if (supplied[0] === "target") Object.assign(target, { x: supplied[1] / 1000, y: supplied[2] / 1000 });
          if (supplied[0] === "buffs") {
            bandit.rage = supplied.includes("Rage") ? { remaining: 10 } : undefined;
            bandit.slow = supplied.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
          }
        }
        while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
        if (frame.hit) hits++;
        ordinary += frame.ordinaryRequests.length;
        const label = `${team}/${JSON.stringify(row.fields)}/${frame.step}`;
        const clock = bandit.pendingAttack?.recovery ?? bandit.banditRecovery;
        expect({ x: bandit.x, y: bandit.y }, label).toEqual({ x: frame.xy[0] / 1000, y: frame.xy[1] / 1000 });
        expect({ elapsed: clock?.elapsedMs ?? 0, reload: clock?.reloadMs ?? 0 }, label)
          .toEqual({ elapsed: frame.elapsedMs, reload: frame.reloadMs });
        expect(bandit.dashCharge?.remainingMs ?? (bandit.dash && frame.clockMs ? 1000 : 0), label).toBe(frame.clockMs);
        expect(!!bandit.dash, label).toBe(frame.state === 4);
        // Request timing is native; this checks delivery using the established
        // normalized browser packet, independently supported by selected delivery.
        expect(target.hp, label).toBe(10000 - hits * Math.round(320 * 1.1 ** 2) - ordinary * bandit.damage);
        frames++; ordinaryRequests += frame.ordinaryRequests.length;
      }
    }
    expect({ frames, ordinaryRequests }).toEqual({ frames: 2868, ordinaryRequests: 68 });
  });
}

for (const team of ["blue", "red"] as const) {
  it(`${team} finishes the committed swing through a legal Tornado and exactly reconstructs its commands`, () => {
    const current = banditTransitionOpening(54, team), old = banditTransitionOpening(53, team);
    for (const scene of [current, old]) {
      const projected = projectTornadoWindup(scene.bandit, scene.knight, [], scene.point);
      if (scene.battle.rulesVersion === 54) expect(projected.releaseStep).toBe(scene.releaseTick - scene.battle.tick);
      else expect(projected.cancelledStep).toBe(1);
      expect(scene.battle.tick).toBe(266);
      pullPreparingBandit(scene);
      while (scene.battle.tick < scene.releaseTick) scene.battle.step();
      expect(Math.hypot(scene.bandit.x - scene.knight.x, scene.bandit.y - scene.knight.y)).toBeGreaterThan(1.85);
      expect(scene.bandit.hp).toBeGreaterThan(0);
      expect(scene.battle.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "knight", "tornado"]);
      const replay = new Battle({ replay: scene.battle.exportReplay() });
      while (replay.tick < scene.battle.tick) replay.step();
      expect(snapshot(replay)).toEqual(snapshot(scene.battle));
      expect(replay.audioEvents).toEqual(scene.battle.audioEvents);
    }
    expect(current.knight.hp).toBe(current.landingHp - current.bandit.damage);
    expect(old.knight.hp).toBe(old.landingHp);
    expect(current.battle.tick).toBe(278);
  });
}

it("keeps committed windup forecasts exact through movement and modifier expiry", () => {
  for (const version of [53, 54] as const) for (const [rage, slow] of [[0, 0], [0.11, 0], [0, 0.27], [0.11, 0.27]]) {
    const { b, bandit, target } = controlled(version);
    while (!bandit.pendingAttack?.recovery?.animating && b.tick < 100) b.step();
    target.x = bandit.x + 5;
    bandit.rage = rage ? { remaining: rage } : undefined;
    bandit.slow = slow ? { remaining: slow } : undefined;
    const before = JSON.stringify(bandit.pendingAttack);
    const forecast = projectTornadoWindup(bandit, target, []);
    expect(JSON.stringify(bandit.pendingAttack)).toBe(before);
    const start = b.tick, hp = target.hp;
    while (target.hp === hp && b.tick < start + 60) b.step();
    if (version === 54) expect(b.tick - start).toBe(forecast.releaseStep);
    else { expect(forecast.cancelledStep).toBe(1); expect(bandit.pendingAttack?.recovery).toBeUndefined(); }
  }
});

it("retains a lethal committed King deadline outside ordinary reach", () => {
  const { b, bandit, target } = controlled();
  while (!bandit.pendingAttack?.recovery?.animating && b.tick < 100) b.step();
  Object.assign(target, { x: bandit.x + 5, card: "tower", kind: "tower", king: true, hp: bandit.damage });
  const forecast = fatalKingWindups(target.team, [bandit, target]);
  expect(forecast).toHaveLength(1);
  const start = b.tick;
  while (target.hp > 0 && b.tick < start + 60) b.step();
  expect(b.tick - start).toBe(forecast[0].step);
});

it("keeps stun, lost-target, shield and protected-target handling on the shared paths", () => {
  for (const effect of ["stun", "lost", "shield", "dash"] as const) {
    const { b, bandit, target } = controlled();
    while (!bandit.pendingAttack?.recovery?.animating && b.tick < 100) b.step();
    const hp = target.hp;
    target.x = bandit.x + 5;
    if (effect === "stun") bandit.stun = 0.2;
    if (effect === "lost") target.hp = 0;
    if (effect === "shield") { target.shield = 50; target.maxShield = 50; }
    if (effect === "dash") target.dash = { target: bandit.id, elapsed: 0, remaining: 5 };
    while (b.tick < 69) b.step();
    if (effect === "lost") expect(target.hp).toBe(0);
    else expect(target.hp).toBe(hp);
    if (effect === "shield") expect(target.shield).toBe(0);
    if (effect === "stun" || effect === "lost") expect(bandit.pendingAttack?.recovery).toBeUndefined();
  }
});

it("pins the runtime phase window to the imported transition and selected delivery evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeTransitions).toMatchObject({ phaseMaximumMs: 50, normalChargeUpdate: 47, rageChargeUpdate: 87 });
});

it("respects retained attraction before starting a fresh post-request charge", () => {
  const { b, bandit, target } = firstOrdinary();
  target.x = bandit.x + 5;
  bandit.dashAttraction = 0.2;
  for (let i = 0; i < 3; i++) b.step();
  expect(bandit.dashCharge).toBeUndefined();
  expect(bandit.hp).toBeGreaterThan(0);
});

it("copies retained launch clocks for guests and removes the policy on old-host replacement", () => {
  const current = firstOrdinary(), old = firstOrdinary(53);
  current.target.x = current.bandit.x + 5;
  while (!current.bandit.dash && current.b.tick < 130) current.b.step();
  expect(current.bandit.dash).toBeDefined();
  expect(current.bandit.banditRecovery?.elapsedMs).toBe(1000);
  const guest = perspective(snapshot(current.b), "red").entities.find((e) => e.card === "bandit")!;
  expect(guest.nativeBanditTransitions).toBe(true);
  expect(guest.banditRecovery).toEqual(current.bandit.banditRecovery);
  expect(guest.banditRecovery).not.toBe(current.bandit.banditRecovery);
  applySnapshot(current.b, snapshot(old.b), "blue");
  expect(current.b.entities.find((e) => e.card === "bandit")?.nativeBanditTransitions).toBeUndefined();
});

it("gives mirrored and cloned Bandits the host policy while fresh copies clear retained clocks", () => {
  for (const version of [53, 54] as const) {
    const { b, bandit } = firstOrdinary(version);
    b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
    expect(b.play("blue", 0, 4, 22).ok).toBe(true);
    const mirrored = b.entities.filter((e) => e.card === "bandit").at(-1)!;
    expect(!!mirrored.nativeBanditTransitions).toBe(version === 54);
    expect(mirrored.banditRecovery).toBeUndefined();
    b.players.blue.hand[0] = "clone"; b.players.blue.elixir = 10;
    expect(b.play("blue", 0, bandit.x, bandit.y).ok).toBe(true); b.step();
    const copy = b.entities.find((e) => e.card === "bandit" && e.clone)!;
    expect(!!copy.nativeBanditTransitions).toBe(version === 54);
    expect(copy.banditRecovery).toBeUndefined();
  }
});

it("keeps ordinary combat before any dash on its existing shared path", () => {
  const current = controlled(), old = controlled(53);
  for (const s of [current, old]) s.target.x = s.bandit.x + 1.5;
  for (let i = 0; i < 90; i++) {
    current.b.step(); old.b.step();
    expect({ hp: current.target.hp, pending: current.bandit.pendingAttack, cooldown: current.bandit.cooldown })
      .toEqual({ hp: old.target.hp, pending: old.bandit.pendingAttack, cooldown: old.bandit.cooldown });
  }
});

it("records and exactly replays a complete rules-54 match", () => {
  const b = new Battle({ replay: { ...golden.cases[6].replay, version: 54 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(54);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
