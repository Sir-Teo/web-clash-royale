import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Frame {
  step: number; state: number; xy: [number, number]; targetHp: number; goalTile: number;
  events: unknown[][]; calls: Record<string, number>; exactHeapChangesOnly: boolean;
}
interface Episode {
  fields: { direction: [number, number]; motion: string; initialClockMs: number;
    origin: [number, number]; initialTarget: [number, number]; movedTarget: [number, number] };
  countdown: { step: number; state: number; clockMs: number; xy: [number, number]; goalTile: number;
    events: unknown[][]; calls: Record<string, number>; exactHeapChangesOnly: boolean }[];
  launchGoal: [number, number];
  launchFrameHold: { state: number; clockMs: number; calls: Record<string, number>; exactHeapChangesOnly: boolean };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/dash-goals-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];

it("pins dash goals to the source binary, fields and prerequisite captures", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toMatchObject({ attacker: "Assassin", target: "Knight",
    sourceDashDamage: 320, sourceDashCooldownMs: 1000, range: 750,
    ownRadius: 600, targetRadius: 500, goalTileSize: 500, worldWidth: 36,
    addCharacterRangeToRadius: true });
  expect(trace.cases).toHaveLength(16);
  expect(trace.controls).toHaveLength(20);
  expect(trace.blocks).toHaveLength(12);
});

function launch(row: Episode) {
  const f = row.fields, p = trace.profiles;
  const goal = f.initialTarget.map((v, i) => v - f.direction[i] * (p.ownRadius + p.targetRadius));
  const tileXY = goal.map((v) => Math.trunc(v / p.goalTileSize));
  const tile = tileXY[1] * p.worldWidth + tileXY[0];
  expect(row.launchGoal).toEqual(goal);
  for (const frame of row.countdown) {
    const remaining = (f.initialClockMs || p.sourceDashCooldownMs) - frame.step * trace.stepMs;
    const launched = remaining <= 0;
    const events: unknown[][] = frame.step === 1 && !f.initialClockMs ? [["providedView", "start"]] : [];
    if (launched) events.push(["providedAllocate", 8], ["goal", ...goal], ["providedFree"], ["stateRequest", 4], ["providedView", "state"]);
    expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state: launched ? 4 : 2,
      clockMs: launched ? p.sourceDashCooldownMs : remaining, xy: f.origin, goalTile: launched ? tile : 0,
      events, exactHeapChangesOnly: true, calls: undefined });
    expect(frame.calls.countdownFragment).toBe(1);
    expect(frame.calls.goalSetter ?? 0).toBe(Number(launched));
    expect(frame.calls.stateSetter ?? 0).toBe(Number(launched));
  }
  expect(row.launchFrameHold).toEqual({ state: 4, clockMs: 1000, calls: { movementFrame: 1 }, exactHeapChangesOnly: true });
  return { tile, point: tileXY.map((v) => (v + 0.5) * p.goalTileSize) };
}

it("independently reconstructs the countdown, launch point, tile and initial movement hold", () => {
  rows.forEach(launch);
  expect(rows.reduce((n, r) => n + r.countdown.length, 0)).toBe(604);
  for (const row of trace.cases as Episode[]) {
    expect(row.countdown).toHaveLength(20);
    expect(row.countdown.slice(0, 19).every((f) => f.state === 2)).toBe(true);
    expect(row.countdown[19]).toMatchObject({ state: 4, clockMs: 1000 });
  }
});

it("reproduces native travel and hit/miss frames with independent geometry", () => {
  const p = trace.profiles;
  const reach = p.range + p.ownRadius + p.targetRadius;
  for (const row of rows) {
    const { tile, point } = launch(row);
    let xy = [...row.fields.origin], landed = false;
    for (const frame of row.frames) {
      const events: unknown[][] = [];
      for (const chunk of [250, 250, 0]) {
        const distance = Math.hypot(point[0] - xy[0], point[1] - xy[1]);
        const travel = Math.min(distance, chunk);
        const move = xy.map((v, i) => travel ? Math.sign(point[i] - v) * travel : 0);
        xy = xy.map((v, i) => v + move[i]);
        events.push(["providedOpenPlaneWrite", ...move]);
        const targetDistance = Math.hypot(xy[0] - row.fields.movedTarget[0], xy[1] - row.fields.movedTarget[1]);
        landed = targetDistance <= reach || Math.trunc(Math.hypot(point[0] - xy[0], point[1] - xy[1]) / p.sourceJumpSpeed) === 0;
        if (landed) break;
      }
      const hit = landed && Math.hypot(xy[0] - row.fields.movedTarget[0], xy[1] - row.fields.movedTarget[1]) <= reach + 500;
      if (landed) {
        events.push(["stateRequest", 1], ["providedDashDamage", 320]);
        if (hit) events.push(["targetHp", 680], ["providedAttackReload"]);
        events.push(["providedBlockedTile", false], ["providedPathRefresh"], ["providedView", "state"]);
      }
      expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state: landed ? 1 : 4,
        xy, targetHp: hit ? 680 : 1000, goalTile: tile, events, exactHeapChangesOnly: true, calls: undefined });
      expect(frame.calls.movementFrame).toBe(1);
      expect(frame.calls.movementUpdate).toBe(1);
      expect(frame.calls.damageReducer ?? 0).toBe(Number(hit));
      expect(frame.calls.dashDamageGetter ?? 0).toBe(Number(landed));
    }
    expect(landed).toBe(true);
  }
  expect(rows.reduce((n, r) => n + r.frames.length, 0)).toBe(256);
  expect(rows.filter((r) => r.frames.at(-1)!.targetHp === 680)).toHaveLength(24);
  expect(rows.filter((r) => r.frames.at(-1)!.targetHp === 1000)).toHaveLength(12);
});

for (const motion of ["stationary", "sideways", "away", "closer"])
  it(`keeps the launch tile when the supplied target is ${motion}`, () => {
    const selected = (trace.cases as Episode[]).filter((r) => r.fields.motion === motion);
    expect(selected).toHaveLength(4);
    for (const row of selected) {
      expect(new Set(row.frames.map((f) => f.goalTile)).size).toBe(1);
      const last = row.frames.at(-1)!;
      expect(last.state).toBe(1);
      expect(last.targetHp).toBe(["stationary", "closer"].includes(motion) ? 680 : 1000);
      expect(row.frames).toHaveLength(motion === "stationary" ? 7 : motion === "closer" ? 3 : 8);
    }
  });

it("continues partial clocks without replaying the start view notification", () => {
  for (const row of (trace.controls as Episode[]).filter((r) => r.fields.initialClockMs > 0)) {
    expect(row.countdown).toHaveLength(row.fields.initialClockMs / 50);
    expect(row.countdown.flatMap((f) => f.events).filter((e) => e[0] === "providedView" && e[1] === "start")).toHaveLength(0);
    expect(row.frames.at(-1)!.targetHp).toBe(680);
  }
});

it("accepts equality at the extended landing bound and rejects one source unit outside", () => {
  const selected = (trace.controls as Episode[]).filter((r) => r.fields.motion.startsWith("landing-"));
  expect(selected).toHaveLength(12);
  const reach = trace.profiles.range + trace.profiles.ownRadius + trace.profiles.targetRadius;
  for (const row of selected) {
    const last = row.frames.at(-1)!;
    const offset = row.fields.motion === "landing-inside" ? -1 : row.fields.motion === "landing-equal" ? 0 : 1;
    const distance = Math.hypot(last.xy[0] - row.fields.movedTarget[0], last.xy[1] - row.fields.movedTarget[1]);
    expect(distance).toBe(reach + 500 + offset);
    expect(distance).toBeGreaterThan(reach);
    expect(last.state).toBe(1);
    expect(last.targetHp).toBe(offset <= 0 ? 680 : 1000);
  }
});
