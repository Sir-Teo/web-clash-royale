import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Episode {
  fields: {
    damage: number; hp: number; level: number; remainingMs: number;
    counter: number; progress: number; state: number; flags: number;
    healthPresent: boolean;
  };
  frames: {
    step: number; remainingMs: number; counter: number; buffCount: number;
    progress: number; hiddenBefore: boolean; hidden: boolean; hp: number;
    pulse: boolean; ordinaryHitBlocked: boolean; events: unknown[][];
    getters: Record<string, number>; dataReads: Record<string, number>;
    exactHeapChangesOnly: boolean;
  }[];
}
const trace = JSON.parse(readFileSync("reference/client/buff-lifecycle-native-trace.json", "utf8"));
const episodes: Episode[] = [...trace.cases, ...trace.controls];

it("pins retained-Poison lifecycle evidence to native prerequisites and source rows", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.cases).toHaveLength(36);
  expect(trace.controls).toHaveLength(32);
  expect(trace.blocks).toHaveLength(13);
  expect(trace.sourceColumns.map((c: { name: string }) => c.name)).toEqual([
    "HidesWhenNotAttacking", "HideBeforeFirstHit", "HideTimeMs", "UpTimeMs", "SpeedMultiplier", "Panic",
  ]);
  expect(trace.profiles).toMatchObject({ target: "Tesla", buff: "Poison", sourceHp: 450, sourceDamage: 57, frequencyMs: 1000, hideTimeMs: 800, upTimeMs: 800 });
});

function compare(row: Episode) {
  const f = row.fields;
  let remaining = f.remainingMs, counter = f.counter, hp = f.hp, count = 1, progress = f.progress;
  const hasHealth = !!(f.flags & 4) && f.healthPresent;
  for (const frame of row.frames) {
    const hiddenBefore = progress === 800;
    let pulse = false;
    const events: unknown[][] = [];
    if (count) {
      if (remaining !== -1) remaining = Math.max(0, remaining - 50);
      counter++;
      pulse = counter >= 20;
      if (pulse) {
        counter = 0;
        events.push(["rate", "damage", f.damage], ["rate", "heal", 0]);
        if (hasHealth) {
          hp -= f.damage;
          events.push(["hp", hp]);
        }
      }
      if (remaining === 0) {
        count = 0;
        events.push(["remove"], ["providedDestructor"], ["providedFree"]);
      }
    }
    progress = [2, 5].includes(f.state) ? Math.max(0, progress - 50) : Math.min(800, progress + 50);
    expect({ ...frame, getters: undefined, dataReads: undefined }).toEqual({
      step: frame.step, remainingMs: remaining, counter, buffCount: count,
      progress, hiddenBefore, hidden: progress === 800, hp, pulse,
      ordinaryHitBlocked: progress === 800, events,
      exactHeapChangesOnly: true, getters: undefined, dataReads: undefined,
    });
    expect(frame.getters.indexedComponent).toBe(4);
    expect(frame.getters.buffManager).toBe(1);
    expect(frame.getters.hideClock).toBe(1);
    expect(frame.getters.providedHealthUpdate ?? 0).toBe(Number(hasHealth));
    expect(frame.getters.damageReducer ?? 0).toBe(Number(pulse && hasHealth));
    expect(frame.getters.providedHiddenOwner ?? 0).toBe(Number(frame.hidden));
  }
}

it("independently reproduces all source and controlled component, expiry, hide and HP frames", () => {
  episodes.forEach(compare);
  const frames = episodes.flatMap((r) => r.frames);
  expect(frames).toHaveLength(1632);
  expect(frames.filter((f) => f.pulse)).toHaveLength(63);
  expect(frames.filter((f) => f.hiddenBefore && f.events.some((e) => e[0] === "hp"))).toHaveLength(36);
  expect(frames.filter((f) => f.ordinaryHitBlocked)).toHaveLength(1374);
});

for (const damage of [57, 121])
  it(`retains the ${damage}-damage Poison clock through the native hidden boundary`, () => {
    const row = episodes.find((r) => r.fields.damage === damage && r.fields.level === 0 && r.fields.counter === 15 && r.fields.progress === 600 && r.fields.remainingMs === 1000)!;
    expect(row.frames[3]).toMatchObject({ progress: 800, hiddenBefore: false, hidden: true, hp: 450, counter: 19, buffCount: 1 });
    expect(row.frames[4]).toMatchObject({ hiddenBefore: true, hidden: true, hp: 450 - damage, counter: 0, ordinaryHitBlocked: true });
    expect(row.frames[4].events).toContainEqual(["hp", 450 - damage]);
    expect(row.frames[19]).toMatchObject({ remainingMs: 0, buffCount: 0 });
    expect(row.frames[19].events).toEqual([["remove"], ["providedDestructor"], ["providedFree"]]);
    expect(row.frames[20].events).toEqual([]);
  });

it("emits a due final pulse before expiry and then removes the status exactly once", () => {
  const rows = episodes.filter((r) => r.fields.remainingMs === 50 && r.fields.counter === 19);
  expect(rows).toHaveLength(1);
  expect(rows[0].frames[0].events).toEqual([
    ["rate", "damage", 57], ["rate", "heal", 0], ["hp", 393],
    ["remove"], ["providedDestructor"], ["providedFree"],
  ]);
  expect(rows[0].frames.slice(1).every((f) => !f.pulse && f.events.length === 0)).toBe(true);
});

it("keeps hidden status clocks running when the supplied health component is unavailable", () => {
  const rows = episodes.filter((r) => !(r.fields.flags & 4) || !r.fields.healthPresent);
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    expect(row.frames.some((f) => f.pulse)).toBe(true);
    expect(row.frames.every((f) => f.hp === 450 && !f.events.some((e) => e[0] === "hp"))).toBe(true);
    expect(row.frames.at(-1)?.buffCount).toBe(0);
  }
});

it("distinguishes supplied raw hide states without resetting or removing Poison early", () => {
  const rows = episodes.filter((r) => [2, 5].includes(r.fields.state));
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row.frames.at(-1)).toMatchObject({ progress: 0, hidden: false, hp: 393, buffCount: 0 });
    expect(row.frames.filter((f) => f.events.some((e) => e[0] === "remove"))).toHaveLength(1);
  }
});
