import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Request {
  tick: number; elapsedMs: number; reloadMs: number; finishMs: number;
  target: string; flag1d: number; hitIndex: number; reloadAfterMs: number;
}
interface Frame {
  step: number; state: number; xy: number[]; target: number[]; targetHp: number;
  clockMs: number; elapsedMs: number; reloadMs: number; flag1d: number; goalTile: number;
  movementHeld: boolean; landed: boolean; hit: boolean; supplied: unknown[][];
  events: unknown[][]; ordinaryRequests: Request[]; calls: Record<string, number>; exactHeapChangesOnly: boolean;
}
interface Episode {
  fields: { direction: number[]; scenario: "hit" | "miss" | "chain";
    recoveryBuffs: string[]; suppliedReloadMs: number | null };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/dash-recovery-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];

it("pins recovery to the native source, complete startup and ordinary-clock evidence", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toEqual({ attacker: "Assassin", target: "Knight", dashDamage: 320,
    targetHp: 1000, dashCooldownMs: 1000, loadTimeMs: 600, hitSpeedMs: 1000,
    range: 750, ownRadius: 600, targetRadius: 500, unitsPerStep: 500, chunkUnits: 250, headingScale: 256 });
  expect(trace.cases).toHaveLength(12);
  expect(trace.controls).toHaveLength(20);
  expect(trace.blocks).toHaveLength(6);
  expect(trace.limits.join(" ")).toContain("Ordinary requests are not proof of downstream normal hits");
});

function reconstruct(row: Episode) {
  const f = row.fields, [dx, dy] = f.direction;
  let xy = [8250, 8250], target = [8250 + 5000 * dx, 8250 + 5000 * dy];
  let state = 2, clock = 0, elapsed = 0, reload = 0, hp = 1000, tile = 0, flag = 0;
  let landings = 0, launchedBefore = false, landedBefore = false, delta = 50;
  for (const frame of row.frames) {
    const supplied: unknown[][] = [], events: unknown[][] = [], requests: Request[] = [];
    if (launchedBefore && f.scenario === "miss") {
      target = [target[0] - 3000 * dy, target[1] + 3000 * dx];
      supplied.push(["target", ...target]);
    }
    if (landedBefore) {
      if (f.scenario === "miss") { target = [xy[0] + 1500 * dx, xy[1] + 1500 * dy]; supplied.push(["target", ...target]); }
      else if (f.scenario === "chain" && landings === 1) {
        target = [xy[0] + 5000 * dx, xy[1] + 5000 * dy]; supplied.push(["target", ...target]);
      }
      const positive = f.recoveryBuffs.includes("Rage") ? 135 : 100;
      const negative = f.recoveryBuffs.includes("IceWizardSlowDown") ? 35 : 0;
      delta = Math.trunc(Math.trunc(50 * positive / 100) * (100 - negative) / 100);
      if (f.recoveryBuffs.length) supplied.push(["buffs", ...f.recoveryBuffs]);
      if (f.suppliedReloadMs !== null) {
        reload = f.suppliedReloadMs; supplied.push(["reloadMs", reload]);
      }
    }
    const old = state;
    launchedBefore = landedBefore = false;
    reload = Math.max(0, reload - 50);
    const distance2 = (target[0] - xy[0]) ** 2 + (target[1] - xy[1]) ** 2;
    const charging = old !== 4 && (clock > 0 || (distance2 >= 4100 ** 2 && distance2 <= 6500 ** 2));
    if (old === 4) { clock = elapsed = flag = 0; }
    else if (charging) {
      if (!clock) { clock = 1000; events.push(["providedView", "start"]); }
      clock = Math.max(0, clock - delta);
      if (!clock) {
        launchedBefore = true; state = 4; clock = 1000;
        const front = [target[0] - 1100 * dx, target[1] - 1100 * dy];
        tile = Math.trunc(front[1] / 500) * 36 + Math.trunc(front[0] / 500);
        events.push(["providedAllocate", 8], ["goal", ...front], ["providedFree"], ["stateRequest", 4], ["providedView", "state"]);
      }
    } else {
      state = 2; clock = 0;
      if (old !== 2) events.push(["providedView", "state"]);
      const beforeCycle = Math.trunc(elapsed / 1000);
      if (!elapsed) {
        elapsed += 600 - reload; reload = 600;
        flag = Number(elapsed % 1000 >= 600);
      }
      elapsed += delta;
      if (Math.trunc(elapsed / 1000) > beforeCycle) {
        flag = 0;
        events.push(["providedView", "attack"], ["ordinaryRequest", -1]);
        requests.push({ tick: frame.step, elapsedMs: elapsed, reloadMs: reload,
          finishMs: 0, target: "a", flag1d: 0, hitIndex: -1, reloadAfterMs: 600 });
        reload = 600;
      }
    }
    const held = clock > 0, moving = state === 4 && !held;
    let landed = false, hit = false;
    if (moving) {
      const goal = [tile % 36 * 500 + 250, Math.trunc(tile / 36) * 500 + 250];
      for (const chunk of [250, 250, 0]) {
        const toGoal = goal.map((v, i) => v - xy[i]);
        const distance = Math.max(1, Math.floor(Math.hypot(...toGoal)));
        const move = toGoal.map((v) => Math.trunc(Math.trunc(v * 256 / distance) * Math.min(chunk, distance) / 256) || 0);
        xy = xy.map((v, i) => v + move[i]);
        events.push(["providedOpenPlaneWrite", ...move]);
        const targetDistance = Math.hypot(xy[0] - target[0], xy[1] - target[1]);
        landed = targetDistance <= 1850 || Math.floor(Math.hypot(xy[0] - goal[0], xy[1] - goal[1]) / 500) === 0;
        if (landed) { hit = targetDistance <= 2350; break; }
      }
      if (landed) {
        landedBefore = true; landings++; state = 1;
        events.push(["stateRequest", 1], ["providedDashDamage", 320]);
        if (hit) { hp -= 320; reload = 600; events.push(["targetHp", hp], ["nativeAttackReload"]); }
        events.push(["providedBlockedTile", false], ["providedPathRefresh"], ["providedView", "state"]);
      }
    }
    expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state, xy, target, targetHp: hp,
      clockMs: clock, elapsedMs: elapsed, reloadMs: reload, flag1d: flag, goalTile: tile,
      movementHeld: held, landed, hit, supplied, events, ordinaryRequests: requests,
      calls: undefined, exactHeapChangesOnly: true });
    expect(frame.calls.fullAttack).toBe(1);
    expect(frame.calls.attackReload ?? 0).toBe(Number(hit));
    expect(frame.calls.ordinaryRequest ?? 0).toBe(requests.length);
    expect(frame.calls.goalSetter ?? 0).toBe(Number(launchedBefore));
    expect(frame.calls.countdownFragment ?? 0).toBe(Number(charging));
    expect(frame.calls.movementFrame ?? 0).toBe(Number(moving || held));
    expect(frame.calls.movementUpdate ?? 0).toBe(Number(moving));
  }
}

it("independently reconstructs all 3200 updates, packets, heap checks and ordered events", () => {
  rows.forEach(reconstruct);
  const frames = rows.flatMap((r) => r.frames);
  expect(frames).toHaveLength(3200);
  expect(frames.filter((f) => f.landed)).toHaveLength(36);
  expect(frames.filter((f) => f.hit)).toHaveLength(32);
  expect(frames.flatMap((f) => f.ordinaryRequests)).toHaveLength(104);
});

it("executes a 600-ms landing reload only on successful dash hits", () => {
  for (const row of rows) for (const frame of row.frames.filter((f) => f.landed)) {
    expect(frame.reloadMs).toBe(frame.hit ? 600 : 0);
    expect(frame.events.some((e) => e[0] === "nativeAttackReload")).toBe(frame.hit);
  }
});

it("reaches the first ordinary request 19 native updates after a successful landing", () => {
  const selected = (trace.cases as Episode[]).filter((r) => r.fields.scenario === "hit");
  expect(selected).toHaveLength(4);
  for (const row of selected) {
    expect(row.frames.find((f) => f.landed)?.step).toBe(27);
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual([46, 66, 86]);
    expect(row.frames[27]).toMatchObject({ elapsedMs: 100, reloadMs: 600, state: 2 });
  }
});

it("recovers from a supplied missed landing without adding the successful-hit reload", () => {
  const selected = (trace.cases as Episode[]).filter((r) => r.fields.scenario === "miss");
  expect(selected).toHaveLength(4);
  for (const row of selected) {
    expect(row.frames.find((f) => f.landed)).toMatchObject({ step: 28, hit: false, reloadMs: 0 });
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual([36, 56, 76, 96]);
    expect(row.frames[28]).toMatchObject({ elapsedMs: 650, flag1d: 1 });
    expect(row.frames.every((f) => f.targetHp === 1000)).toBe(true);
  }
});

it("begins the next supplied charge immediately despite a positive ordinary reload", () => {
  const selected = (trace.cases as Episode[]).filter((r) => r.fields.scenario === "chain");
  expect(selected).toHaveLength(4);
  for (const row of selected) {
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([27, 54]);
    expect(row.frames[27]).toMatchObject({ state: 1, clockMs: 950, reloadMs: 550, elapsedMs: 0, movementHeld: true });
    expect(row.frames[46]).toMatchObject({ state: 4, clockMs: 1000, reloadMs: 0 });
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual([73, 93]);
    expect(row.frames.at(-1)?.targetHp).toBe(360);
  }
});

it("applies integer Rage/slow deltas to recovery independently of real-time reload decrement", () => {
  const first = { Rage: 42, IceWizardSlowDown: 57, "Rage,IceWizardSlowDown": 50 };
  for (const [buffs, step] of Object.entries(first)) {
    const selected = rows.filter((r) => r.fields.recoveryBuffs.join(",") === buffs);
    expect(selected).toHaveLength(4);
    for (const row of selected) {
      expect(row.frames.find((f) => f.ordinaryRequests.length)?.step).toBe(step);
      expect(row.frames[28].reloadMs).toBe(550);
    }
  }
});

it("distinguishes supplied partial reloads and retains actual ordinary prefix records", () => {
  for (const [reload, delay] of [[0, 8], [200, 11]]) {
    const selected = rows.filter((r) => r.fields.suppliedReloadMs === reload);
    expect(selected).toHaveLength(4);
    for (const row of selected) {
      expect(row.frames.find((f) => f.ordinaryRequests.length)?.step).toBe(27 + delay);
      for (const request of row.frames.flatMap((f) => f.ordinaryRequests))
        expect(request).toMatchObject({ target: "a", hitIndex: -1, reloadAfterMs: 600 });
    }
  }
});
