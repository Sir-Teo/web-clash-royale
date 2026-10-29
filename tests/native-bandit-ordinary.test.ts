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
  movementTimeMs: number; movementPreviousTimeMs: number;
  movementHeld: boolean; landed: boolean; hit: boolean; supplied: unknown[][];
  events: unknown[][]; ordinaryRequests: Request[]; calls: Record<string, number>; exactHeapChangesOnly: boolean;
}
interface Episode {
  fields: { direction: number[]; scenario: string; initialBuffs: string[];
    initialElapsedMs: number; initialReloadMs: number; shiftUpdate: number | null;
    initialTargetDistance: number; buffSchedule: [number, string[]][] };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/bandit-ordinary-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];
const ticks = (r: Episode) => r.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step);
const stable = (r: Episode, modifier: string[]) => r.fields.scenario === "ordinary-stationary" &&
  !r.fields.buffSchedule.length && JSON.stringify(r.fields.initialBuffs) === JSON.stringify(modifier);

it("pins fresh ordinary episodes to source constructor clocks and the complete transition driver", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  expect(createHash("sha256").update(readFileSync("reference/client/bandit-ordinary-native-trace.json")).digest("hex"))
    .toBe("5266a984039b1772cde8aad4bc64ea7a9788ad8edbcc1110af040b030f6aa745");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.profiles).toMatchObject({ attacker: "Assassin", target: "Knight", hitSpeedMs: 1000,
    loadTimeMs: 600, initialTargetDistance: 1750, initialElapsedMs: 0, initialReloadMs: 0,
    initialExtraClockMs: 0, attackDashTimeMs: 0, dashAdmissionPhaseMaximumMs: 50 });
  const prior = JSON.parse(readFileSync("reference/client/roster-first-attacks-native-trace.json", "utf8"));
  const source = prior.cases.filter((r: any) => r.sourceName === "Assassin" && !r.syntheticFirstLoad);
  expect(source).toHaveLength(4);
  for (const row of source) {
    expect(row.sourceLoadFirstHit).toBe(false);
    expect(row.constructed).toMatchObject({ elapsedMs: 0, reloadMs: 0, target: null });
    expect(row.assigned).toMatchObject({ elapsedMs: 0, reloadMs: 0, target: "a" });
  }
  expect(trace.cases).toHaveLength(8);
  expect(trace.controls).toHaveLength(48);
  expect(trace.blocks).toHaveLength(8);
  for (const block of trace.blocks) expect(block.instructions.length).toBeGreaterThan(3);
});

function reconstruct(row: Episode) {
  const f = row.fields, [dx, dy] = f.direction;
  let xy = [8250, 8250], target = [8250 + f.initialTargetDistance * dx, 8250 + f.initialTargetDistance * dy];
  let state = 2, clock = 0, elapsed = f.initialElapsedMs, reload = f.initialReloadMs, hp = 1000, tile = 0, flag = 0;
  let movementTime = 0, previousTime = 0, movementDelta = 50;
  let launchedBefore = false;
  let active = f.initialBuffs;
  let delta = 50;
  for (const frame of row.frames) {
    const supplied: unknown[][] = [], events: unknown[][] = [], requests: Request[] = [];
    if (frame.step === f.shiftUpdate) {
      target = [xy[0] + 5000 * dx, xy[1] + 5000 * dy];
      supplied.push(["target", ...target]);
    }
    for (const [at, names] of f.buffSchedule) if (frame.step === at) {
      active = names; supplied.push(["buffs", ...active]);
    }
    const positive = active.includes("Rage") ? 135 : 100;
    const negative = active.includes("IceWizardSlowDown") ? 35 : 0;
    delta = Math.trunc(Math.trunc(50 * positive / 100) * (100 - negative) / 100);
    const speed = Math.trunc(Math.trunc(90 * positive / 100) * (100 - negative) / 100);
    movementDelta = Math.trunc(50 * speed / 90);
    const old = state;
    launchedBefore = false;
    reload = Math.max(0, reload - 50);
    const distance2 = (target[0] - xy[0]) ** 2 + (target[1] - xy[1]) ** 2;
    const charging = old !== 4 && elapsed % 1000 <= 50 && (clock > 0 || (distance2 >= 4100 ** 2 && distance2 <= 6500 ** 2));
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
      previousTime = movementTime; movementTime += movementDelta;
      if (landed) {
        state = 1;
        events.push(["stateRequest", 1], ["providedDashDamage", 320]);
        if (hit) { hp -= 320; reload = 600; events.push(["targetHp", hp], ["nativeAttackReload"]); }
        events.push(["providedBlockedTile", false], ["providedPathRefresh"], ["providedView", "state"]);
      }
    }
    expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state, xy, target, targetHp: hp,
      clockMs: clock, elapsedMs: elapsed, reloadMs: reload, flag1d: flag, goalTile: tile,
      movementHeld: held, movementTimeMs: movementTime, movementPreviousTimeMs: previousTime,
      landed, hit, supplied, events, ordinaryRequests: requests,
      calls: undefined, exactHeapChangesOnly: true });
    expect(frame.calls.fullAttack).toBe(1);
    expect(frame.calls.admission).toBe(2 - Number(old === 4));
    expect(frame.calls.attackReload ?? 0).toBe(Number(hit));
    expect(frame.calls.ordinaryRequest ?? 0).toBe(requests.length);
    expect(frame.calls.goalSetter ?? 0).toBe(Number(launchedBefore));
    expect(frame.calls.countdownFragment ?? 0).toBe(Number(charging));
    expect(frame.calls.movementFrame ?? 0).toBe(Number(moving || held));
    expect(frame.calls.movementUpdate ?? 0).toBe(Number(moving));
    expect(frame.calls.providedPrimaryScan ?? 0).toBe(Number(distance2 > 1850 ** 2));
    expect(frame.calls.providedExtraScan ?? 0).toBe(0);
  }
}


it("independently reconstructs every fresh-cycle update, heap claim, event, request and selected driver", () => {
  rows.forEach(reconstruct);
  const frames = rows.flatMap((r) => r.frames);
  expect(frames).toHaveLength(4480);
  expect(frames.filter((f) => f.landed)).toHaveLength(24);
  expect(frames.filter((f) => f.hit)).toHaveLength(24);
  expect(frames.flatMap((f) => f.ordinaryRequests)).toHaveLength(192);
});

it("keeps the initial load adjustment and integer first clock for every direction and modifier", () => {
  for (const [modifier, first] of [[[], 650], [["Rage"], 667], [["IceWizardSlowDown"], 632],
    [["Rage", "IceWizardSlowDown"], 643]] as const) {
    const matches = rows.filter((r) => stable(r, [...modifier]));
    expect(matches).toHaveLength(4);
    for (const row of matches) expect(row.frames[0]).toMatchObject({ elapsedMs: first, reloadMs: 600, flag1d: 1, clockMs: 0 });
  }
});

it("retains native integer cadence from the first close-range request through later requests", () => {
  for (const [modifier, expected] of [[[], [8, 28, 48, 68]], [["Rage"], [6, 21, 36, 51, 66]],
    [["IceWizardSlowDown"], [13, 44, 75]], [["Rage", "IceWizardSlowDown"], [10, 33, 56, 80]]] as const)
    for (const row of rows.filter((r) => stable(r, [...modifier]))) {
      expect(ticks(row)).toEqual(expected);
      expect(row.frames.some((f) => f.clockMs || f.landed)).toBe(false);
    }
});

it("keeps an early or preparing close-range cycle queued before accepting the distant dash", () => {
  const moved = rows.filter((r) => ["ordinary-early", "ordinary-windup"].includes(r.fields.scenario));
  expect(moved).toHaveLength(8);
  for (const row of moved) {
    expect(row.fields.shiftUpdate).toBe(row.fields.scenario === "ordinary-early" ? 3 : 5);
    expect(ticks(row)).toEqual([8, 54, 74]);
    expect(row.frames.find((f) => f.clockMs)?.step).toBe(9);
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([35]);
    expect(row.frames[7].target.map((v, i) => v - row.frames[7].xy[i]))
      .toEqual(row.fields.direction.map((v) => v * 5000 || 0));
  }
});

it("admits a fresh Rage follow-up at its 2-ms remainder rather than the post-landing 55-ms remainder", () => {
  const fresh = rows.filter((r) => r.fields.scenario === "ordinary-released" && r.fields.initialBuffs.join() === "Rage");
  const old = JSON.parse(readFileSync("reference/client/dash-transition-native-trace.json", "utf8"));
  expect(fresh).toHaveLength(4);
  for (const row of fresh) {
    expect(row.frames[5]).toMatchObject({ elapsedMs: 1002, reloadMs: 600 });
    expect(row.frames[6]).toMatchObject({ step: 7, elapsedMs: 1002, reloadMs: 550, clockMs: 933 });
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([28]);
    const afterLanding = old.controls.find((r: any) => r.fields.recoveryBuffs.join() === "Rage" &&
      JSON.stringify(r.fields.direction) === JSON.stringify(row.fields.direction));
    expect(afterLanding.frames[41]).toMatchObject({ elapsedMs: 1055, clockMs: 0 });
    expect(afterLanding.frames[86]).toMatchObject({ elapsedMs: 4003, clockMs: 933 });
  }
});

it("executes supplied modifier replacements on the exact frame without resetting the ordinary cycle", () => {
  const expected = [[7, 27, 47, 67], [11, 31, 51, 71], [11, 31, 51, 71], [7, 26, 46, 66]];
  const schedules = rows.filter((r) => r.fields.buffSchedule.length);
  expect(schedules).toHaveLength(16);
  schedules.forEach((row, i) => {
    expect(ticks(row)).toEqual(expected[i % 4]);
    expect(row.frames.flatMap((f) => f.supplied.filter((s) => s[0] === "buffs").map((s) => [f.step, s.slice(1)])))
      .toEqual(row.fields.buffSchedule);
    expect(row.frames.some((f) => f.landed || f.clockMs)).toBe(false);
  });
});

it("keeps ordinary damage, natural acquisition, expiry and scheduling outside the bounded capture", () => {
  expect(trace.limits.join(" ")).toContain("ordinary target HP remains unchanged");
  expect(trace.limits.join(" ")).toContain("constructor and natural acquisition are not executed here");
  expect(trace.limits.join(" ")).toContain("not natural target motion, acquisition, application or expiry");
  expect(trace.limits.join(" ")).toContain("Gameplay remains rules 54");
  for (const row of rows) {
    let hp = 1000;
    for (const frame of row.frames) {
      if (frame.hit) hp -= 320;
      expect(frame.targetHp).toBe(hp);
      expect(frame.calls.providedExtraScan ?? 0).toBe(0);
      for (const request of frame.ordinaryRequests)
        expect(request).toMatchObject({ target: "a", hitIndex: -1, reloadAfterMs: 600 });
    }
  }
});
