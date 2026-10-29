import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Frame {
  step: number; state: number; flags: number; xy: [number, number]; hp: number;
  remainingMs: number; counter: number; pulse: boolean; ordinaryHitBlocked: boolean;
  events: unknown[][]; calls: Record<string, number>; exactHeapChangesOnly: boolean;
}
interface Episode {
  fields: { direction: [number, number]; counter: number; damage: number; hp: number;
    flags: number; control: string | null };
  entry: { state: number; flags: number; hp: number; attackFinish: number;
    chargeClock: number; events: unknown[][]; calls: Record<string, number>;
    exactHeapChangesOnly: boolean };
  frames: Frame[];
}
const trace = JSON.parse(readFileSync("reference/client/dash-lifecycle-native-trace.json", "utf8"));
const episodes: Episode[] = [...trace.cases, ...trace.controls];

it("pins dash evidence to the native binary, source rows and prerequisite captures", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.stepMs).toBe(50);
  expect(trace.profiles).toEqual({ target: "Assassin", buff: "Poison", sourceHp: 750,
    sourceDamage: 57, normalizedDamageControl: 121, sourceSpeed: 90,
    sourceJumpSpeed: 500, frequencyMs: 1000 });
  expect(trace.cases).toHaveLength(16);
  expect(trace.controls).toHaveLength(10);
  expect(trace.blocks).toHaveLength(16);
  expect(trace.sourceColumns.map((c: { name: string }) => c.name)).toEqual([
    "Speed", "ChargeRange", "DashCooldown", "JumpHeight", "JumpSpeed",
  ]);
});

it("enters dash through the actual state setter without disabling health or retained buffs", () => {
  for (const row of episodes) {
    expect({ ...row.entry, calls: undefined }).toEqual({ state: 4, flags: 15, hp: 750,
      attackFinish: 0, chargeClock: -1, events: [["providedViewNotification"]],
      exactHeapChangesOnly: true, calls: undefined });
    for (const name of ["stateSetter", "movementEntry", "clearAttackFinish", "componentActivation", "componentMask"])
      expect(row.entry.calls[name]).toBe(1);
  }
});

function compare(row: Episode) {
  const { direction: [dx, dy], damage, counter, control, flags } = row.fields;
  const moves = !["movement-disabled", "movement-absent"].includes(control ?? "");
  const healthy = !["health-disabled", "health-absent"].includes(control ?? "");
  const retained = control !== "empty-buffs";
  let hp = 750, elapsed = counter;
  for (const frame of row.frames) {
    const pulse = retained && ++elapsed === 20;
    if (elapsed === 20) elapsed = 0;
    const events: unknown[][] = moves ? [
      ["providedOpenPlaneWrite", dx * 250, dy * 250],
      ["providedOpenPlaneWrite", dx * 250, dy * 250],
      ["providedOpenPlaneWrite", 0, 0],
    ] : [];
    if (pulse) {
      events.push(["rate", "damage", damage], ["rate", "heal", 0]);
      if (healthy) events.push(["hp", hp -= damage]);
    }
    expect({ ...frame, calls: undefined }).toEqual({ step: frame.step, state: 4, flags,
      xy: [8250 + Number(moves) * frame.step * 500 * dx, 8250 + Number(moves) * frame.step * 500 * dy],
      hp, remainingMs: retained ? 2000 - frame.step * 50 : 2000,
      counter: retained ? elapsed : counter, pulse, ordinaryHitBlocked: healthy,
      events, exactHeapChangesOnly: true, calls: undefined });
    expect(frame.calls.movementGeometry ?? 0).toBe(Number(moves) * 3);
    expect(frame.calls.movementUpdate ?? 0).toBe(Number(moves));
    expect(frame.calls.movementFrame ?? 0).toBe(Number(moves));
    expect(frame.calls.excludedMovementNotification ?? 0).toBe(Number(moves));
    expect(frame.calls.buffUpdate ?? 0).toBe(Number(retained));
    expect(frame.calls.ordinaryHit ?? 0).toBe(Number(healthy) * 2);
    expect(frame.calls.damageReducer ?? 0).toBe(Number(pulse && healthy));
    expect(frame.calls.lowerDamageProxy ?? 0).toBe(Number(pulse && healthy));
  }
}

it("independently reproduces every supplied movement, tick and HP frame", () => {
  episodes.forEach(compare);
  const frames = episodes.flatMap((r) => r.frames);
  expect(frames).toHaveLength(208);
  expect(frames.filter((f) => f.pulse)).toHaveLength(24);
  expect(frames.filter((f) => f.events.some((e) => e[0] === "hp"))).toHaveLength(20);
  expect(frames.filter((f) => f.ordinaryHitBlocked)).toHaveLength(176);
});

it("advances half a tile per native 50-ms update in all four cardinal directions", () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const row = (trace.cases as Episode[]).find((r) => r.fields.direction[0] === dx && r.fields.direction[1] === dy)!;
    for (const frame of row.frames) {
      const distance = Math.hypot(frame.xy[0] - 8250, frame.xy[1] - 8250) / 1000;
      expect(distance / (frame.step * trace.stepMs / 1000)).toBe(10);
    }
  }
});

for (const damage of [57, 121])
  it(`applies retained ${damage}-damage Poison during an advancing dash while ordinary hits stay blocked`, () => {
    for (const counter of [12, 19]) {
      const rows = (trace.cases as Episode[]).filter((r) => r.fields.damage === damage && r.fields.counter === counter);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        const due = row.frames[19 - counter];
        expect(due).toMatchObject({ state: 4, flags: 15, hp: 750 - damage,
          counter: 0, pulse: true, ordinaryHitBlocked: true });
        expect(due.events.at(-1)).toEqual(["hp", 750 - damage]);
        expect(row.frames.every((f) => f.ordinaryHitBlocked && f.state === 4)).toBe(true);
      }
    }
  });

it("separates missing health, held movement and absent retained status controls", () => {
  for (const row of trace.controls as Episode[]) {
    const control = row.fields.control!;
    if (control.startsWith("health-")) {
      expect(row.frames.every((f) => f.hp === 750 && !f.ordinaryHitBlocked)).toBe(true);
      expect(row.frames.some((f) => f.pulse)).toBe(true);
      expect(row.frames.at(-1)!.xy).toEqual([12250, 8250]);
    } else if (control.startsWith("movement-")) {
      expect(row.frames.every((f) => f.xy[0] === 8250)).toBe(true);
      expect(row.frames[0].hp).toBe(750 - row.fields.damage);
    } else {
      expect(control).toBe("empty-buffs");
      expect(row.frames.every((f) => !f.pulse && f.hp === 750 && f.counter === 19)).toBe(true);
    }
  }
});
