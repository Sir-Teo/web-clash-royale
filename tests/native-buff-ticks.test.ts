import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Episode {
  fields: {
    sourceName: string;
    targetSource: string;
    damage: number;
    heal: number;
    frequencyMs: number;
    percent: number;
    level: number;
    rarity: number;
    remainingMs: number;
    counter: number;
    componentFlags: number;
    componentPresent: boolean;
    requestWord: number;
    payload: number;
  };
  refresh: Record<string, number>;
  frames: {
    step: number;
    refreshedMs: number | null;
    remainingMs: number;
    counter: number;
    pulse: boolean;
    expired: boolean;
    events: unknown[][];
  }[];
  exactHeapChangesOnly: boolean;
}
const trace = JSON.parse(
  readFileSync("reference/client/buff-ticks-native-trace.json", "utf8"),
);
const episodes: Episode[] = [...trace.cases, ...trace.controls];

it("pins native buff evidence to its binary, source inputs and named rate columns", () => {
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
  for (const input of trace.inputs)
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(trace.cases).toHaveLength(64);
  expect(trace.controls).toHaveLength(215);
  expect(trace.blocks).toHaveLength(10);
  expect(trace.sourceColumns.map((c: { name: string }) => c.name)).toEqual([
    "DamagePerSecond",
    "HealPerSecond",
    "HitFrequency",
    "CrownTowerDamagePercent",
  ]);
});

function compare(row: Episode) {
  const f = row.fields;
  let remaining = f.remainingMs;
  let counter = f.counter;
  const crown = ["PrincessTower", "KingTower"].includes(f.targetSource);
  const active = f.componentPresent && !!(f.componentFlags & 4);
  for (const frame of row.frames) {
    const refresh = row.refresh[String(frame.step)] ?? null;
    if (refresh !== null) remaining = refresh;
    if (remaining !== -1) remaining = Math.max(0, remaining - 50);
    let pulse = false;
    if (f.frequencyMs > 0) {
      counter++;
      pulse = counter >= Math.trunc(f.frequencyMs / 50);
      if (pulse) counter = 0;
    }
    const events: unknown[][] = [];
    if (pulse) {
      for (const reduced of crown ? [false, true] : [false])
        for (const kind of ["damage", "heal"] as const)
          events.push(["table", kind, reduced, f.level, f.rarity, f[kind]]);
      if (active)
        for (const kind of ["damage", "heal"] as const) {
          const amount = crown
            ? Math.ceil((f[kind] * Math.max(0, 100 + f.percent)) / 100)
            : Math.trunc((f[kind] * f.frequencyMs) / 1000);
          if (amount <= 0) continue;
          events.push(
            kind === "damage"
              ? ["damage", amount, f.requestWord, f.payload, 0, 0]
              : ["heal", amount],
          );
        }
    }
    expect(frame).toEqual({
      step: frame.step,
      refreshedMs: refresh,
      remainingMs: remaining,
      counter,
      pulse,
      expired: remaining === 0,
      events,
    });
  }
  expect(row.exactHeapChangesOnly).toBe(true);
}

for (const source of [
  "Rage", "Freeze", "Poison", "IceWizardSlowDown",
  "ZapFreeze", "Tornado", "Clone", "Heal",
])
  it(`independently reproduces native ${source} clocks and rate requests`, () => {
    const rows = (trace.cases as Episode[]).filter(
      (r) => r.fields.sourceName === source,
    );
    expect(rows).toHaveLength(8);
    rows.forEach(compare);
  });

it("reproduces rounding, frequency, refresh, component and expiry controls", () => {
  (trace.controls as Episode[]).forEach(compare);
  const frames = episodes.flatMap((r) => r.frames);
  expect(frames).toHaveLength(2872);
  expect(frames.filter((f) => f.pulse)).toHaveLength(616);
  const requests = frames.flatMap((f) => f.events);
  expect(requests.filter((e) => e[0] === "damage")).toHaveLength(523);
  expect(requests.filter((e) => e[0] === "heal")).toHaveLength(376);
});

it("requests 49 Crown damage from normalized Poison and retains tick phase on refresh", () => {
  const normalized = episodes.filter(
    (r) => r.fields.damage === 121 && r.fields.percent === -60 &&
      r.fields.frequencyMs === 1000 && r.frames.length === 1 &&
      ["PrincessTower", "KingTower"].includes(r.fields.targetSource),
  );
  expect(normalized).toHaveLength(2);
  for (const row of normalized)
    expect(row.frames[0].events).toContainEqual(["damage", 49, -37, -23, 0, 0]);
  const refreshed = episodes.filter((r) => Object.keys(r.refresh).length);
  expect(refreshed).toHaveLength(3);
  for (const row of refreshed) {
    const first = 20 - row.fields.counter;
    expect(row.frames.filter((f) => f.pulse).map((f) => f.step)).toEqual(
      [first, first + 20].filter((step) => step <= row.frames.length),
    );
  }
});
