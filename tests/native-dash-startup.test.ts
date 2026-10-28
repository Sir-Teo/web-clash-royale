import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Change { step: number; distance?: number; target?: boolean; buffs?: string[] }
interface Frame {
  step: number; state: number; clockMs: number; targetPresent: boolean; target: [number, number];
  buffs: string[]; xy: [number, number]; goalTile: number; movementHeld: boolean;
  events: unknown[][]; calls: Record<string, number>; exactHeapChangesOnly: boolean;
}
interface Episode {
  fields: { direction: [number, number]; initialDistance: number; initialClockMs: number;
    initialBuffs: string[]; changes: Change[]; stepLimit: number };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/dash-startup-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];
const buffValues: Record<string, [number, number]> = {
  Rage: [135, 0], IceWizardSlowDown: [-35, 0], Freeze: [-100, 0],
  ZapFreeze: [-100, 0], Clone: [-100, 0], Tornado: [0, 220],
};
const delta = (buffs: string[]) => {
  const rates = buffs.map((b) => buffValues[b][0]);
  return Math.trunc(Math.trunc(50 * Math.max(100, ...rates) / 100) *
    Math.max(0, 100 - Math.max(0, ...rates.map((v) => -v))) / 100);
};
const launchStep = (r: Episode) => r.frames.find((f) => f.state === 4)?.step;

it("pins complete startup updates to archived inputs and separate admission/goal evidence", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toEqual({ attacker: "Assassin", target: "Knight", dashCooldownMs: 1000,
    hitSpeedMs: 1000, loadTimeMs: 600, ownRadius: 600, targetRadius: 500,
    initialMinimum: 4100, initialMaximum: 6500, retentionMaximum: 7500 });
  expect(trace.cases).toHaveLength(16);
  expect(trace.controls).toHaveLength(58);
  expect(trace.blocks).toHaveLength(5);
  expect(trace.blocks[0]).toMatchObject({ name: "completeAttack", start: "0x25c60c", end: "0x25d068" });
  expect(trace.limits.join(" ")).toContain("hard-stun actor scheduling/component activation");
});

function reconstruct(row: Episode) {
  const f = row.fields;
  let distance = f.initialDistance, clock = f.initialClockMs, state = 2,
    targetPresent = true, goalTile = 0, buffs = f.initialBuffs;
  for (const frame of row.frames) {
    for (const change of f.changes.filter((c) => c.step === frame.step)) {
      if (change.distance !== undefined) distance = change.distance;
      if (change.target !== undefined) targetPresent = change.target;
      if (change.buffs) buffs = change.buffs;
    }
    const events: unknown[][] = [];
    const wasDashing = state === 4, targetBefore = targetPresent;
    const target = f.direction.map((v) => 8250 + distance * v);
    const canceled = targetPresent && clock > 0 && distance > 7500;
    if (canceled) {
      targetPresent = false; clock = 0;
      events.push(["providedReset"], ["providedPathRefresh"]);
    }
    const eligible = targetPresent && !buffs.some((b) => buffValues[b][1] > 0) &&
      (clock > 0 || (delta(buffs) > 0 && distance >= 4100 && distance <= 6500));
    let countdown = false, launched = false;
    if (!eligible) {
      clock = 0;
      if (!wasDashing) events.push(["providedReset"]);
    }
    if (wasDashing) clock = 0;
    else if (eligible) {
      countdown = true;
      if (clock <= 0) { clock = 1000; events.push(["providedView", "start"]); }
      clock = Math.max(0, clock - delta(buffs));
      if (clock === 0) {
        state = 4; clock = 1000; launched = true;
        const goal = target.map((v, i) => v - 1100 * f.direction[i]);
        goalTile = Math.trunc(goal[1] / 500) * 36 + Math.trunc(goal[0] / 500);
        events.push(["providedAllocate", 8], ["goal", ...goal], ["providedFree"],
          ["stateRequest", 4], ["providedView", "state"]);
      }
    }
    expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state, clockMs: clock,
      targetPresent, target, buffs, xy: [8250, 8250], goalTile, movementHeld: clock > 0,
      events, calls: undefined, exactHeapChangesOnly: true });
    expect(frame.calls.fullAttack).toBe(1);
    expect(frame.calls.admission ?? 0).toBe(Number(targetPresent) * (wasDashing ? 1 : 2));
    expect(frame.calls.attackRange ?? 0).toBe(Number(targetBefore) + Number(targetPresent && !wasDashing));
    expect(frame.calls.providedPrimaryScan).toBe(1);
    expect(frame.calls.providedValidity ?? 0).toBe(Number(targetBefore));
    expect(frame.calls.countdownFragment ?? 0).toBe(Number(countdown));
    expect(frame.calls.buffClock ?? 0).toBe(Number(countdown) + Number(launched));
    expect(frame.calls.stateSetter ?? 0).toBe(Number(launched));
    expect(frame.calls.goalSetter ?? 0).toBe(Number(launched));
    expect(frame.calls.targetSetter ?? 0).toBe(Number(canceled));
    expect(frame.calls.providedReset ?? 0).toBe(events.filter((e) => e[0] === "providedReset").length);
    expect(frame.calls.movementFrame ?? 0).toBe(Number(clock > 0));
    expect(frame.calls.movementUpdate ?? 0).toBe(0);
    expect(frame.calls.dashClockClear ?? 0).toBe(Number(wasDashing));
  }
}

it("independently reconstructs all full updates, heap checks, external events and driver counts", () => {
  rows.forEach(reconstruct);
  expect(rows.reduce((n, r) => n + r.frames.length, 0)).toBe(1505);
  expect(rows.filter((r) => launchStep(r))).toHaveLength(54);
});

it("charges at native integer rates for all four source directions", () => {
  const expected = { "": 20, Rage: 15, IceWizardSlowDown: 32, "Rage,IceWizardSlowDown": 24 };
  for (const row of trace.cases as Episode[]) {
    expect(launchStep(row)).toBe(expected[row.fields.initialBuffs.join(",") as keyof typeof expected]);
    const launch = launchStep(row)!;
    expect(row.frames.slice(0, launch - 1).every((f) => f.state === 2)).toBe(true);
    expect(row.frames.at(-2)).toMatchObject({ state: 4, clockMs: 1000, movementHeld: true });
    expect(row.frames.at(-1)).toMatchObject({ state: 4, clockMs: 0, movementHeld: false });
  }
});

it("keeps a wider pending target window and cancels one source unit beyond it", () => {
  for (const distance of [6501, 7499, 7500, 7501]) {
    const selected = rows.filter((r) => r.fields.changes[0]?.distance === distance);
    expect(selected).toHaveLength(4);
    for (const row of selected) {
      expect(launchStep(row)).toBe(distance <= 7500 ? 20 : undefined);
      expect(row.frames[5]).toMatchObject({ targetPresent: distance <= 7500, clockMs: distance <= 7500 ? 700 : 0 });
      if (distance === 7501) expect(row.frames[5].events).toEqual([
        ["providedReset"], ["providedPathRefresh"], ["providedReset"],
      ]);
    }
  }
});

it("chooses the destination at launch after the supplied target moves", () => {
  const selected = rows.filter((r) => r.fields.changes[0]?.distance !== undefined && launchStep(r));
  expect(selected).toHaveLength(16);
  for (const row of selected) {
    expect(row.frames.slice(0, 19).every((f) => f.goalTile === 0)).toBe(true);
    const launch = row.frames[19];
    const expected = row.fields.direction.map((v) => 8250 + (row.fields.changes[0].distance! - 1100) * v);
    expect(launch.events).toContainEqual(["goal", ...expected]);
  }
});

it("distinguishes supplied freezing clock pauses from attraction cancellation and restart", () => {
  for (const buff of ["Freeze", "ZapFreeze", "Clone", "Tornado"]) {
    const initial = rows.find((r) => r.fields.initialBuffs[0] === buff)!;
    expect(launchStep(initial)).toBeUndefined();
    const added = rows.find((r) => r.fields.changes[0]?.buffs?.[0] === buff)!;
    expect(launchStep(added)).toBe(buff === "Tornado" ? 29 : 24);
    expect(added.frames.slice(5, 9).every((f) => f.clockMs === (buff === "Tornado" ? 0 : 750))).toBe(true);
    expect(added.frames.flatMap((f) => f.events).filter((e) => e[0] === "providedView" && e[1] === "start"))
      .toHaveLength(buff === "Tornado" ? 2 : 1);
  }
});

it("resumes partial clocks and changes rate without restarting their start notification", () => {
  for (const initial of [50, 500]) {
    const selected = rows.filter((r) => r.fields.initialClockMs === initial);
    expect(selected).toHaveLength(4);
    for (const row of selected) {
      expect(launchStep(row)).toBe(initial / 50);
      expect(row.frames.flatMap((f) => f.events).some((e) => e[0] === "providedView" && e[1] === "start")).toBe(false);
    }
  }
  for (const [buff, launch] of [["Rage", 17], ["IceWizardSlowDown", 29]] as const) {
    const row = rows.find((r) => r.fields.changes[0]?.buffs?.[0] === buff)!;
    expect(launchStep(row)).toBe(launch);
    expect(row.frames.flatMap((f) => f.events).filter((e) => e[0] === "providedView" && e[1] === "start")).toHaveLength(1);
  }
});

it("clears a missing supplied reference without launching or invoking a target setter", () => {
  const selected = rows.filter((r) => r.fields.changes[0]?.target === false);
  expect(selected).toHaveLength(4);
  for (const row of selected) {
    expect(launchStep(row)).toBeUndefined();
    expect(row.frames.slice(5).every((f) => !f.targetPresent && f.clockMs === 0 && !f.goalTile)).toBe(true);
    expect(row.frames.slice(5).every((f) => !f.calls.targetSetter)).toBe(true);
  }
});
