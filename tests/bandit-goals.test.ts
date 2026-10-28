import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { banditDashGoal, banditGoalFrame } from "../src/game/bandit-dash";
import { applySnapshot, perspective, snapshot } from "../src/network/perspective";
import { banditDashOpening } from "./fixtures/bandit-dash-setup";
import { banditGoalOpening, finishCommittedDash } from "./fixtures/bandit-goals-setup";
import golden from "./fixtures/bandit-goals-rules48-golden.json";

const native = JSON.parse(readFileSync("reference/client/dash-goals-native-trace.json", "utf8"));
const rows = [...native.cases, ...native.controls];
const special = Math.round(320 * 1.1 ** 2);
const point = (xy: number[]) => ({ x: xy[0] / 1000, y: xy[1] / 1000 });
const digest = (b: Battle) => createHash("sha256").update(JSON.stringify(Object.fromEntries(golden.stateFields.map((key) => [key, (b as any)[key]])))).digest("hex");

function controlled(row: any, version: Replay["version"] = 49, team: Team = "blue") {
  const b = new Battle({ replay: { ...new Battle({ seed: 2, ai: false }).exportReplay(), version } });
  for (const e of b.entities) Object.assign(e, { active: false, radius: 0 });
  const start = point(row.fields.origin), aim = point(row.fields.initialTarget);
  (b as any).spawn("bandit", team, start.x, start.y, false, 0);
  const bandit = b.entities.at(-1)!;
  (b as any).spawn("knight", team === "blue" ? "red" : "blue", aim.x, aim.y, false, 0);
  const target = b.entities.at(-1)!;
  Object.assign(target, { active: false, speed: 0, hp: 1000, maxHp: 1000 });
  if (row.fields.motion === "dashing-target") target.dash = { target: bandit.id, elapsed: 0, remaining: 1 };
  bandit.dash = { target: target.id, elapsed: 0, remaining: 1,
    ...(version >= 49 ? { goal: banditDashGoal(bandit, target), carry: 0 } : {}) };
  Object.assign(target, point(row.fields.movedTarget));
  if (row.fields.motion === "target-cleared") b.entities = b.entities.filter((e) => e !== target);
  return { b, bandit, target };
}

it("preserves five independently built complete rules-48 games", () => {
  expect(golden.cases).toHaveLength(5);
  expect(golden.cases[4].clearedDash).toEqual({ victimDeaths: 1, canceledOnNextStep: 1 });
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
});

it("pins the runtime goal and movement constants to native evidence", () => {
  const manifest = JSON.parse(readFileSync("reference/client/bandit-manifest.json", "utf8"));
  for (const input of [...manifest.inputs, manifest.output])
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(manifest.nativeGoal).toMatchObject({ fixedStepMs: 50, landingExtensionUnits: 500 });
});

it("matches native tile destinations, fixed movement and hit/miss results across all 92 episodes", () => {
  for (const row of rows) {
    let actor = { ...point(row.fields.origin), radius: 0.6, range: 0.75, rangeRadiusFactor: 1 };
    const target = { ...point(row.fields.initialTarget), radius: 0.5,
      ...(row.fields.motion === "dashing-target" ? { dash: { target: 0, elapsed: 0, remaining: 1 } } : {}) };
    const goal = banditDashGoal(actor, target), tile = row.countdown.at(-1).goalTile;
    expect(goal).toEqual({ x: (tile % 36 + 0.5) * 0.5, y: (Math.trunc(tile / 36) + 0.5) * 0.5 });
    Object.assign(target, point(row.fields.movedTarget));
    for (const frame of row.frames) {
      const result = banditGoalFrame(actor, goal, row.fields.motion === "target-cleared" ? undefined : target);
      expect({ x: result.x, y: result.y }).toEqual(point(frame.xy));
      expect(result.landed).toBe(frame.state === 1);
      expect(result.hit).toBe(frame.targetHp === 680);
      actor = { ...actor, x: result.x, y: result.y };
    }
  }
});

it("integrates each captured native frame into the 30-Hz battle with the same positions and landing outcome", () => {
  for (const row of rows) {
    const { b, bandit, target } = controlled(row);
    for (const frame of row.frames) {
      while (b.tick < Math.ceil(frame.step * 1.5)) b.step();
      expect({ x: bandit.x, y: bandit.y }, `${row.fields.direction}/${row.fields.motion}/${frame.step}`).toEqual(point(frame.xy));
      expect(!!bandit.dash).toBe(frame.state === 4);
      expect(target.hp).toBe(frame.targetHp === 680 ? 1000 - special : 1000);
    }
  }
});

for (const team of ["blue", "red"] as const) {
  it(`${team} legally removes the target with Zap and preserves the committed route through replay`, () => {
    const current = banditGoalOpening(49, team), old = banditGoalOpening(48, team);
    expect(current.target.hp).toBe(0);
    expect(current.bandit.dash).toBeDefined();
    expect(old.bandit.dash).toBeUndefined();
    const before = { x: current.bandit.x, y: current.bandit.y };
    finishCommittedDash(current.battle, current.bandit);
    expect(Math.hypot(current.bandit.x - before.x, current.bandit.y - before.y)).toBeGreaterThan(1);
    expect(Math.hypot(current.bandit.x - current.goal!.x, current.bandit.y - current.goal!.y)).toBeLessThan(0.5);
    expect(current.battle.exportReplay().actions.map((a) => a.card)).toEqual(["bandit", "skeletons", "zap"]);
    expect(current.battle.audioEvents.filter((e) => e.phase === "impact-special")).toHaveLength(0);
    const replay = new Battle({ replay: current.battle.exportReplay() });
    while (replay.tick < current.battle.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(current.battle));
    expect(replay.audioEvents).toEqual(current.battle.audioEvents);
  });
  it(`${team} commits to the launch point while the historical dash follows the moved target`, () => {
    const row = rows.find((r) => r.fields.motion === "sideways" && r.fields.direction[0] === 1);
    const current = controlled(row, 49, team), old = controlled(row, 48, team);
    for (let step = 0; step < 12; step++) { current.b.step(); old.b.step(); }
    expect(current.bandit.y).toBe(8.25);
    expect(old.bandit.y).toBeGreaterThan(8.25);
    expect(current.target.hp).toBe(1000);
    expect(old.target.hp).toBe(1000 - special);
    expect(current.bandit.nativeBanditGoal).toBe(true);
    expect(old.bandit.nativeBanditGoal).toBeUndefined();
  });

  it(`${team} keeps existing Poison ticks during the committed dash and replays the legal opening`, () => {
    const { battle: b, bandit } = banditDashOpening(49, team);
    const before = { x: bandit.x, y: bandit.y, hp: bandit.hp };
    expect(bandit.dash?.goal).toBeDefined();
    b.step();
    expect(bandit.hp).toBe(before.hp - 121);
    expect({ x: bandit.x, y: bandit.y }).toEqual({ x: before.x, y: before.y });
    expect(bandit.dash?.carry).toBeCloseTo(STEP);
    const replay = new Battle({ replay: b.exportReplay() });
    while (replay.tick < b.tick) replay.step();
    expect(snapshot(replay)).toEqual(snapshot(b));
    expect(replay.audioEvents).toEqual(b.audioEvents);
  });
}

it("finishes the latched route when its target reference is gone", () => {
  const row = rows.find((r) => r.fields.motion === "target-cleared" && r.fields.direction[0] === 1);
  const current = controlled(row), old = controlled(row, 48);
  current.b.step(); old.b.step();
  expect(current.bandit.dash).toBeDefined();
  expect(old.bandit.dash).toBeUndefined();
  while (current.bandit.dash && current.b.tick < 30) current.b.step();
  expect({ x: current.bandit.x, y: current.bandit.y }).toEqual(point(row.frames.at(-1).xy));
  expect(current.target.hp).toBe(1000);
  expect(current.b.audioEvents.filter((e) => e.phase === "impact-special")).toHaveLength(0);
});

it("lets the native landing hit reach a dashing victim while ordinary hits remain blocked", () => {
  const row = rows.find((r) => r.fields.motion === "dashing-target" && r.fields.direction[0] === 1);
  for (const version of [48, 49] as const) {
    const { b, bandit, target } = controlled(row, version);
    (b as any).hurt(target, 75);
    expect(target.hp).toBe(1000);
    while (bandit.dash && b.tick < 30) b.step();
    expect(target.hp).toBe(version === 49 ? 1000 - special : 1000);
  }
});

it("preserves whole-packet shield absorption for the extended landing hit", () => {
  const row = rows.find((r) => r.fields.motion === "landing-equal" && r.fields.direction[0] === 1);
  const { b, bandit, target } = controlled(row);
  target.shield = target.maxShield = 1;
  while (bandit.dash && b.tick < 30) b.step();
  expect(target.shield).toBe(0);
  expect(target.hp).toBe(1000);
});

it("rotates the latched goal without aliasing it and retains the host policy through replacement", () => {
  const row = rows.find((r) => r.fields.motion === "sideways" && r.fields.direction[0] === 1);
  const current = controlled(row, 49, "red"), old = controlled(row, 48, "red");
  current.b.step();
  const saved = structuredClone(snapshot(current.b));
  const guest = perspective(saved, "red").entities.find((e) => e.card === "bandit")!;
  expect(guest.nativeBanditGoal).toBe(true);
  expect(guest.dash?.goal).toEqual({ x: 18 - current.bandit.dash!.goal!.x, y: 32 - current.bandit.dash!.goal!.y });
  expect(guest.dash?.carry).toBe(current.bandit.dash?.carry);
  guest.dash!.goal!.x++;
  expect(snapshot(current.b)).toEqual(saved);
  applySnapshot(old.b, saved, "red");
  expect(old.b.entities.find((e) => e.card === "bandit")?.nativeBanditGoal).toBe(true);
  applySnapshot(old.b, snapshot(controlled(row, 48, "red").b), "red");
  expect(old.b.entities.find((e) => e.card === "bandit")?.nativeBanditGoal).toBeUndefined();
});

it("gives mirrored Bandits the host's committed-dash policy", () => {
  const row = rows.find((r) => r.fields.motion === "stationary");
  const { b } = controlled(row);
  b.players.blue.lastPlayed = "bandit"; b.players.blue.hand[0] = "mirror"; b.players.blue.elixir = 10;
  expect(b.play("blue", 0, 4, 22).ok).toBe(true);
  expect(b.entities.filter((e) => e.card === "bandit").at(-1)!.nativeBanditGoal).toBe(true);
});

it("records and exactly replays a complete current-rules match", () => {
  const b = new Battle({ replay: { ...golden.cases[3].replay, version: 49 } as Replay });
  while (!b.winner && b.tick < 12000) b.step();
  expect(b.winner).not.toBeNull();
  const replay = new Battle({ replay: b.exportReplay() });
  while (replay.tick < b.tick) replay.step();
  expect(replay.rulesVersion).toBe(49);
  expect(snapshot(replay)).toEqual(snapshot(b));
  expect(replay.audioEvents).toEqual(b.audioEvents);
});
