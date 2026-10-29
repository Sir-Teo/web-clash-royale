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
  fields: { direction: number[]; scenario: "ordinary-early" | "ordinary-windup" | "ordinary-released" | "phase-boundary";
    recoveryBuffs: string[]; initialElapsedMs: number; initialReloadMs: number; shiftUpdate: number | null };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/dash-transition-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];

it("pins ordinary-to-dash transitions to native source and prior complete recovery evidence", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toEqual({ attacker: "Assassin", target: "Knight", dashDamage: 320,
    targetHp: 1000, sourceSpeed: 90, dashCooldownMs: 1000, loadTimeMs: 600, hitSpeedMs: 1000,
    dashAdmissionPhaseMaximumMs: 50, initialExtraClockMs: 0, attackDashTimeMs: 0,
    range: 750, ownRadius: 600, targetRadius: 500, unitsPerStep: 500, chunkUnits: 250, headingScale: 256 });
  expect(trace.cases).toHaveLength(12);
  expect(trace.controls).toHaveLength(48);
  expect(trace.blocks).toHaveLength(8);
  expect(trace.limits.join(" ")).toContain("do not establish downstream ordinary hit eligibility");
});

function reconstruct(row: Episode) {
  const f = row.fields, [dx, dy] = f.direction;
  let xy = [8250, 8250], target = [8250 + 5000 * dx, 8250 + 5000 * dy];
  let state = 2, clock = 0, elapsed = f.initialElapsedMs, reload = f.initialReloadMs, hp = 1000, tile = 0, flag = 0;
  let movementTime = 0, previousTime = 0, movementDelta = 50;
  let landings = 0, launchedBefore = false, landedBefore = false, delta = 50;
  for (const frame of row.frames) {
    const supplied: unknown[][] = [], events: unknown[][] = [], requests: Request[] = [];
    if (frame.step === f.shiftUpdate) {
      target = [xy[0] + 5000 * dx, xy[1] + 5000 * dy];
      supplied.push(["target", ...target]);
    }
    if (landedBefore && landings === 1) {
      const positive = f.recoveryBuffs.includes("Rage") ? 135 : 100;
      const negative = f.recoveryBuffs.includes("IceWizardSlowDown") ? 35 : 0;
      delta = Math.trunc(Math.trunc(50 * positive / 100) * (100 - negative) / 100);
      const speed = Math.trunc(Math.trunc(90 * positive / 100) * (100 - negative) / 100);
      movementDelta = Math.trunc(50 * speed / 90);
      if (f.recoveryBuffs.length) supplied.push(["buffs", ...f.recoveryBuffs]);
    }
    const old = state;
    launchedBefore = landedBefore = false;
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
        landedBefore = true; landings++; state = 1;
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
  }
}

it("independently reconstructs every update, ordered event, request, counter and driver inventory", () => {
  rows.forEach(reconstruct);
  const frames = rows.flatMap((r) => r.frames);
  expect(frames).toHaveLength(2868);
  expect(frames.filter((f) => f.landed)).toHaveLength(48);
  expect(frames.filter((f) => f.hit)).toHaveLength(48);
  expect(frames.flatMap((f) => f.ordinaryRequests)).toHaveLength(68);
});

it("keeps an ordinary cycle queued after an early or preparing supplied target displacement", () => {
  for (const row of trace.cases as Episode[]) {
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([27, 73]);
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual([46, 92]);
    expect(row.frames[46]).toMatchObject({ state: 2, clockMs: 950, elapsedMs: 1000, reloadMs: 550 });
    expect(row.frames[65]).toMatchObject({ state: 4, clockMs: 1000 });
    if (row.fields.scenario !== "ordinary-released") {
      const shift = row.fields.scenario === "ordinary-early" ? 33 : 39;
      expect(row.fields.shiftUpdate).toBe(shift);
      for (const frame of row.frames.slice(shift - 1, 46)) {
        expect(frame.clockMs).toBe(0);
        expect(frame.state).toBe(2);
        expect(Math.hypot(frame.xy[0] - frame.target[0], frame.xy[1] - frame.target[1])).toBe(5000);
      }
    }
  }
});

it("admits the inclusive 50-ms phase edge while blocking 51 ms with the same distant target", () => {
  const controls = rows.filter((r) => r.fields.scenario === "phase-boundary");
  expect(controls).toHaveLength(36);
  for (const row of controls) {
    const phase = row.fields.initialElapsedMs % 1000;
    expect(row.frames[0].clockMs).toBe(phase <= 50 ? 950 : 0);
    expect(row.frames.every((f) => f.calls.admission === 2)).toBe(true);
    if (row.fields.initialElapsedMs === 999) {
      expect(row.frames[0].ordinaryRequests).toHaveLength(1);
      expect(row.frames[0].elapsedMs).toBe(1049);
      expect(row.frames[1]).toMatchObject({ elapsedMs: 1049, clockMs: 950, reloadMs: 550 });
    }
  }
  const block = trace.blocks.find((b: any) => b.name === "ordinaryPhaseAdmission");
  expect(block.start).toBe("0x25cb57");
  expect(block.end).toBe("0x25cc50");
  expect(block.instructions.some((s: string) => /cmp\s+edx,0x32/.test(s))).toBe(true);
});

it("waits for a later eligible phase under Rage instead of admitting after every ordinary request", () => {
  for (const row of rows.filter((r) => r.fields.recoveryBuffs.join() === "Rage")) {
    expect(row.fields.shiftUpdate).toBe(43);
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual([42, 57, 72, 86, 123]);
    expect(row.frames.slice(42, 86).every((f) => !f.clockMs)).toBe(true);
    expect(row.frames[86]).toMatchObject({ state: 2, clockMs: 933, elapsedMs: 4003, reloadMs: 550 });
    expect(row.frames[100]).toMatchObject({ state: 4, clockMs: 1000 });
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([27, 108]);
  }
});

it("admits the captured slow and combined-modifier request remainders on the following update", () => {
  for (const [buffs, shift, initialClock, launch, landing, requests] of [
    ["IceWizardSlowDown", 58, 968, 89, 96, [57, 126]],
    ["Rage,IceWizardSlowDown", 51, 957, 74, 81, [50, 104, 127]],
  ] as const) for (const row of rows.filter((r) => r.fields.recoveryBuffs.join() === buffs)) {
    expect(row.fields.shiftUpdate).toBe(shift);
    expect(row.frames[shift - 1]).toMatchObject({ clockMs: initialClock, reloadMs: 550 });
    expect(row.frames[launch - 1]).toMatchObject({ state: 4, clockMs: 1000 });
    expect(row.frames.filter((f) => f.landed).map((f) => f.step)).toEqual([27, landing]);
    expect(row.frames.filter((f) => f.ordinaryRequests.length).map((f) => f.step)).toEqual(requests);
  }
});

it("scales the movement time counter while retaining fixed protected dash geometry", () => {
  for (const [buffs, delta, endTime] of [["Rage", 67, 819], ["IceWizardSlowDown", 32, 574], ["Rage,IceWizardSlowDown", 43, 651]] as const)
    for (const row of rows.filter((r) => r.fields.recoveryBuffs.join() === buffs)) {
      const second = row.frames.filter((f) => f.movementTimeMs > 350);
      const moving = second.filter((f) => (f.calls.movementUpdate ?? 0) > 0);
      expect(moving).toHaveLength(7);
      for (const frame of moving) expect(frame.movementTimeMs - frame.movementPreviousTimeMs).toBe(delta);
      expect(moving.at(-1)?.movementTimeMs).toBe(endTime);
      expect(moving[0].events.filter((e) => e[0] === "providedOpenPlaneWrite").map((e) => Math.hypot(Number(e[1]), Number(e[2]))))
        .toEqual([250, 250, 0]);
    }
});

it("keeps ordinary delivery outside the claim while checking surviving dash HP and reload stores", () => {
  expect(trace.limits.join(" ")).toContain("Gameplay remains rules 53");
  for (const row of rows) {
    let hp = 1000;
    for (const frame of row.frames) {
      if (frame.hit) hp -= 320;
      expect(frame.targetHp).toBe(hp);
      for (const request of frame.ordinaryRequests)
        expect(request).toMatchObject({ target: "a", hitIndex: -1, reloadAfterMs: 600 });
    }
  }
});
