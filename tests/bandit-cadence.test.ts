import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { snapshot, perspective, applySnapshot } from "../src/network/perspective";
import { projectTornadoWindup } from "../src/game/tornado-pull";
import { fatalKingWindups } from "../src/game/king-spell-race";
import { banditCadenceOpening } from "./fixtures/bandit-cadence-setup";
import golden from "./fixtures/bandit-cadence-rules52-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-recovery-native-trace.json", "utf8"));
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(
  golden.stateFields.map((k) => [k, (b as any)[k]])))).digest("hex");

function controlled(version: Replay["version"] = 53, team: Team = "blue", direction = [1, 0]) {
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
function firstOrdinary(version: Replay["version"] = 53) {
  const scene = controlled(version);
  while (scene.target.hp > 10000 - Math.round(320 * 1.1 ** 2) - scene.bandit.damage && scene.b.tick < 100) scene.b.step();
  expect(scene.b.tick).toBe(69);
  return scene;
}

it("preserves six complete rules-52 games independently built from the saved historical engine", () => {
  expect(golden.sourceCommit).toBe("566a885");
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
}, 15000);

it("pins continuing cadence to the imported complete ordinary-request evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeCadence).toMatchObject({ stepMs: 50, ordinaryRequests: 104, rageRequestUpdates: [42, 57, 72, 86] });
});

for (const team of ["blue", "red"] as const) {
  it(`${team} matches all 3,200 native updates and 104 ordinary requests across all 32 episodes`, () => {
    let requests = 0, frames = 0;
    for (const row of [...native.cases, ...native.controls]) {
      const { b, bandit, target } = controlled(53, team, row.fields.direction);
      let hits = 0, ordinary = 0;
      for (const frame of row.frames) {
        for (const supplied of frame.supplied) {
          if (supplied[0] === "target") Object.assign(target, { x: supplied[1] / 1000, y: supplied[2] / 1000 });
          if (supplied[0] === "reloadMs") bandit.banditRecovery!.reloadMs = supplied[1];
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
        if (frame.elapsedMs > 0) expect(clock, label).toBeDefined();
        if (clock) expect({ elapsed: clock.elapsedMs, reload: clock.reloadMs }, label)
          .toEqual({ elapsed: frame.elapsedMs, reload: frame.reloadMs });
        // Native ordinary delivery is stubbed; check request timing against the
        // browser's existing normalized damage packet, not native ordinary HP.
        expect(target.hp, label).toBe(10000 - hits * Math.round(320 * 1.1 ** 2) - ordinary * bandit.damage);
        frames++; requests += frame.ordinaryRequests.length;
      }
      const clock = bandit.pendingAttack?.recovery ?? bandit.banditRecovery;
      expect(b.audioEvents.filter((e) => e.phase === "attack")).toHaveLength(ordinary + Number(!!clock?.animating));
    }
    expect({ frames, requests }).toEqual({ frames: 3200, requests: 104 });
  });
}

it("removes later-request drift under every captured stable modifier", () => {
  const expected = [[69, 99, 129], [63, 86, 108, 129], [86, 132], [75, 110, 144]];
  const old = [[69, 99, 129], [63, 86, 109, 132], [86, 134], [75, 110, 145]];
  for (const [index, buffs] of [[], ["Rage"], ["IceWizardSlowDown"], ["Rage", "IceWizardSlowDown"]].entries()) {
    for (const version of [52, 53] as const) {
      const { b, bandit, target } = controlled(version);
      while (!bandit.banditRecovery && b.tick < 100) b.step();
      bandit.rage = buffs.includes("Rage") ? { remaining: 10 } : undefined;
      bandit.slow = buffs.includes("IceWizardSlowDown") ? { remaining: 10 } : undefined;
      const ticks = [];
      while (b.tick < 150) {
        const hp = target.hp; b.step();
        if (target.hp < hp) ticks.push(b.tick);
      }
      expect(ticks, `${version}/${buffs}`).toEqual(version === 53 ? expected[index] : old[index]);
    }
  }
});

it("keeps target selection available between native ordinary windups", () => {
  const { b, bandit, target } = firstOrdinary();
  expect(bandit.pendingAttack).toBeUndefined();
  expect(bandit.banditRecovery?.elapsedMs).toBe(1000);
  (b as any).spawn("knight", "red", bandit.x + 1.5, bandit.y, false, 0);
  const other = b.entities.at(-1)!;
  Object.assign(other, { active: false, hp: 10000, maxHp: 10000 });
  (b as any).acquireTarget = () => other;
  for (let i = 0; i < 8; i++) { b.step(); expect(bandit.pendingAttack).toBeUndefined(); }
  while (!bandit.pendingAttack && b.tick < 110) b.step();
  expect(bandit.pendingAttack?.target).toBe(other.id);
  const previousHp = target.hp;
  while (other.hp === 10000 && b.tick < 120) b.step();
  expect(b.tick).toBe(99);
  expect(other.hp).toBe(10000 - bandit.damage);
  expect(target.hp).toBe(previousHp);
});

it("keeps later windup forecasts exact through modifier expiry", () => {
  for (const [rage, slow] of [[0, 0], [0.11, 0], [0, 0.27], [0.11, 0.27]]) {
    const { b, bandit, target } = firstOrdinary();
    while (!bandit.pendingAttack && b.tick < 110) b.step();
    bandit.rage = rage ? { remaining: rage } : undefined;
    bandit.slow = slow ? { remaining: slow } : undefined;
    Object.assign(target, { card: "tower", kind: "tower", king: true, hp: bandit.damage });
    const before = JSON.stringify(bandit.pendingAttack);
    const pull = projectTornadoWindup(bandit, target, []);
    const fatal = fatalKingWindups(target.team, [bandit, target]);
    expect(JSON.stringify(bandit.pendingAttack)).toBe(before);
    expect(fatal).toHaveLength(1);
    const start = b.tick;
    while (target.hp > 0 && b.tick < start + 60) b.step();
    expect(b.tick - start, `${rage}/${slow}`).toBe(pull.releaseStep);
    expect(b.tick - start).toBe(fatal[0].step);
  }
});

it("returns to shared cancellation when the ordinary chain loses range or is stunned", () => {
  for (const effect of ["stun", "range", "dead"] as const) {
    const { b, bandit, target } = firstOrdinary();
    if (effect === "stun") bandit.stun = 0.2;
    else if (effect === "range") target.x = bandit.x + 3;
    else target.hp = 0;
    b.step();
    expect(bandit.banditRecovery).toBeUndefined();
    expect(bandit.pendingAttack?.recovery).toBeUndefined();
  }
});

it("copies later-cycle clocks for guests and removes the new policy on old-host replacement", () => {
  const current = firstOrdinary(), old = firstOrdinary(52);
  const guest = perspective(snapshot(current.b), "red").entities.find((e) => e.card === "bandit")!;
  expect(guest.nativeBanditCadence).toBe(true);
  expect(guest.banditRecovery).toEqual(current.bandit.banditRecovery);
  expect(guest.banditRecovery).not.toBe(current.bandit.banditRecovery);
  while (!current.bandit.pendingAttack && current.b.tick < 110) current.b.step();
  const active = perspective(snapshot(current.b), "red").entities.find((e) => e.card === "bandit")!;
  expect(active.pendingAttack?.recovery).toEqual(current.bandit.pendingAttack?.recovery);
  expect(active.pendingAttack?.recovery).not.toBe(current.bandit.pendingAttack?.recovery);
  applySnapshot(current.b, snapshot(old.b), "blue");
  expect(current.b.entities.find((e) => e.card === "bandit")?.nativeBanditCadence).toBeUndefined();
});

it("starts a cloned Bandit with the existing fresh-attack setup instead of its parent's later-cycle clock", () => {
  const { b, bandit } = firstOrdinary();
  expect(bandit.banditRecovery?.elapsedMs).toBe(1000);
  b.players.blue.hand[0] = "clone"; b.players.blue.elixir = 10;
  expect(b.play("blue", 0, bandit.x, bandit.y).ok).toBe(true);
  b.step();
  const copy = b.entities.find((e) => e.card === "bandit" && e.clone)!;
  expect(copy).toBeDefined();
  expect(copy.nativeBanditCadence).toBe(true);
  expect(copy.banditRecovery).toBeUndefined();
  expect(copy.pendingAttack).toBeUndefined();
  expect(copy.cooldown).toBeGreaterThan(0);
  expect(bandit.banditRecovery?.elapsedMs).toBeGreaterThanOrEqual(1000);
});

it("gives mirrored Bandits their host cadence policy", () => {
  for (const version of [52, 53] as const) {
    const { b } = controlled(version);
    b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
    expect(b.play("blue", 0, 4, 22).ok).toBe(true);
    expect(!!b.entities.filter((e) => e.card === "bandit").at(-1)!.nativeBanditCadence).toBe(version === 53);
  }
});

for (const team of ["blue", "red"] as const) {
  it(`${team} legally completes four ordinary attacks with and without Rage and reconstructs from commands`, () => {
    for (const raged of [false, true]) {
      const results: number[][] = [];
      for (const version of [52, 53] as const) {
        const scene = banditCadenceOpening(version, team, raged), b = scene.battle;
        const ticks: number[] = [];
        while (ticks.length < 4 && b.tick < scene.landingTick + 180 && scene.bandit.hp > 0) {
          const hp = scene.knight.hp; b.step();
          if (scene.knight.hp < hp) ticks.push(b.tick);
        }
        expect(ticks).toHaveLength(4);
        results.push(ticks);
        expect(b.exportReplay().actions.map((a) => a.card)).toEqual(raged ? ["bandit", "knight", "rage"] : ["bandit", "knight"]);
        const replay = new Battle({ replay: b.exportReplay() });
        while (replay.tick < b.tick) replay.step();
        expect(snapshot(replay)).toEqual(snapshot(b));
        expect(replay.audioEvents).toEqual(b.audioEvents);
      }
      expect(results[1][0]).toBe(results[0][0]);
      if (raged) expect(results[1][3]).toBeLessThan(results[0][3]);
      else expect(results[1]).toEqual(results[0]);
    }
  });
}

it("keeps ordinary attacks before any dash on the existing path", () => {
  const current = controlled(), old = controlled(52);
  for (const s of [current, old]) s.target.x = s.bandit.x + 1.5;
  for (let i = 0; i < 120; i++) {
    current.b.step(); old.b.step();
    expect({ hp: current.target.hp, pending: current.bandit.pendingAttack, cooldown: current.bandit.cooldown })
      .toEqual({ hp: old.target.hp, pending: old.bandit.pendingAttack, cooldown: old.bandit.cooldown });
    expect(current.bandit.banditRecovery).toBeUndefined();
  }
});

it("exactly replays a complete rules-53 match", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 53 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(53);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
