import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

interface Episode {
  fields: { direction: [number, number]; requestedDistance: number; origin: [number, number];
    target: [number, number]; activeClockMs: number; targetState: number; cooldownMs: number;
    speed: number; buffs: { name: string; speedMultiplier: number; attraction: number }[] };
  returned: number; calls: Record<string, number>; events: string[]; exactHeapUnchanged: boolean;
}
const trace = JSON.parse(readFileSync("reference/client/dash-admission-native-trace.json", "utf8"));
const rows: Episode[] = [...trace.cases, ...trace.controls];

it("pins dash admission to archived source inputs and the bounded native helper", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.profiles).toEqual({ attacker: "Assassin", target: "Knight", speed: 90,
    dashCooldownMs: 1000, dashMinimum: 4000, dashMaximum: 6000, ownRadius: 600, targetRadius: 500 });
  expect(trace.sourceColumns).toEqual([
    { name: "DashMinRange", string: 0x614168, gotOffset: 0x1848, dataOffset: 0x1dc },
    { name: "DashMaxRange", string: 0x614175, gotOffset: 0x184c, dataOffset: 0x1f8 },
    { name: "SpeedMultiplier", string: 0x6135bf, dataOffset: 0x48 },
    { name: "AttractPercentage", string: 0x6134ef, dataOffset: 0x6c },
  ]);
  expect(trace.cases).toHaveLength(120);
  expect(trace.controls).toHaveLength(219);
  expect(trace.blocks).toHaveLength(11);
  expect(trace.blocks[0]).toMatchObject({ name: "admission", start: "0x25d852", end: "0x25d946" });
  expect(trace.limits.join(" ")).toContain("not a full natural startup capture");
});

function reconstruct(row: Episode) {
  const f = row.fields;
  const events = ["admission", "providedOwner", "data", "providedOwner", "buffComponent", "attractionGate"];
  let blocked = false;
  for (const buff of f.buffs) {
    events.push("attractionGetter");
    if (buff.attraction > 0) { blocked = true; break; }
  }
  let accepted = !blocked && f.activeClockMs > 0;
  if (!blocked && f.activeClockMs <= 0) {
    events.push("dashEnabled");
    if (f.cooldownMs > 0) {
      events.push("buffComponent", "speed", "buffSpeed");
      let positive = 100, negative = 0;
      for (const buff of f.buffs) {
        events.push("panic", "speedMultiplier");
        positive = Math.max(positive, buff.speedMultiplier);
        negative = Math.max(negative, -buff.speedMultiplier);
      }
      const speed = Math.trunc(Math.trunc(f.speed * positive / 100) * Math.max(0, 100 - negative) / 100);
      if (speed > 0) {
        events.push("maximum", "minimum", "radiusData", "providedPositionOwner", "position", "geometry");
        const radius = [4, 6].includes(f.targetState) ? 0 : trace.profiles.targetRadius;
        for (let i = 0; i < 2; i++) {
          events.push("targetRadius");
          if (radius) events.push("radiusData");
          events.push("providedAssertion");
        }
        const lower = trace.profiles.dashMinimum + trace.profiles.ownRadius - radius;
        const upper = trace.profiles.dashMaximum + radius;
        const distance2 = f.origin.reduce((sum, v, i) => sum + (v - f.target[i]) ** 2, 0);
        accepted = distance2 >= lower ** 2 && distance2 <= upper ** 2;
      }
    }
  }
  expect(row.returned).toBe(Number(accepted));
  expect(row.events).toEqual(events);
  const counts: Record<string, number> = {};
  for (const name of events) counts[name] = (counts[name] ?? 0) + 1;
  expect(row.calls).toEqual(counts);
  expect(row.exactHeapUnchanged).toBe(true);
}

it("independently reproduces every result, ordered getter call and unchanged heap", () => {
  rows.forEach(reconstruct);
  expect(rows.filter((r) => r.returned)).toHaveLength(192);
});

it("checks inclusive 4100/6500 source-unit boundaries in twelve directions", () => {
  const cases = trace.cases as Episode[];
  expect(new Set(cases.map((r) => r.fields.direction.join(","))).size).toBe(12);
  for (const distance of [4099, 4100, 4101, 6499, 6500, 6501]) {
    const selected = cases.filter((r) => r.fields.requestedDistance === distance);
    expect(selected).toHaveLength(12);
    for (const row of selected) reconstruct(row);
  }
  for (const row of cases.filter((r) => Math.abs(r.fields.direction[0]) + Math.abs(r.fields.direction[1]) === 1))
    expect(row.returned).toBe(Number(row.fields.requestedDistance >= 4100 && row.fields.requestedDistance <= 6500));
});

it("uses a zero target radius for supplied dash/jump states", () => {
  for (const state of [4, 6]) {
    const selected = rows.filter((r) => r.fields.targetState === state);
    expect(selected).toHaveLength(9);
    for (const row of selected) {
      expect(row.returned).toBe(Number(row.fields.requestedDistance >= 4600 && row.fields.requestedDistance <= 6000));
      expect(row.calls.targetRadius).toBe(2);
      expect(row.calls.radiusData).toBe(1);
    }
  }
});

it("lets a positive clock bypass configured cooldown, speed and range checks", () => {
  const selected = rows.filter((r) => r.fields.activeClockMs > 0 && !r.fields.buffs.some((b) => b.attraction > 0));
  expect(selected.some((r) => r.fields.cooldownMs <= 0 && r.fields.speed <= 0)).toBe(true);
  expect(selected.some((r) => r.fields.requestedDistance === 0)).toBe(true);
  expect(selected.some((r) => r.fields.requestedDistance === 8000)).toBe(true);
  for (const row of selected) {
    expect(row.returned).toBe(1);
    expect(row.calls.dashEnabled).toBeUndefined();
    expect(row.calls.buffSpeed).toBeUndefined();
    expect(row.calls.geometry).toBeUndefined();
  }
});

it("checks positive attraction before the active-clock shortcut", () => {
  const selected = rows.filter((r) => r.fields.buffs.some((b) => b.attraction > 0));
  expect(selected.some((r) => r.fields.activeClockMs > 0)).toBe(true);
  expect(selected.some((r) => r.fields.buffs.length === 3)).toBe(true);
  for (const row of selected) {
    expect(row.returned).toBe(0);
    expect(row.calls.attractionGetter).toBe(row.fields.buffs.findIndex((b) => b.attraction > 0) + 1);
    expect(row.calls.dashEnabled).toBeUndefined();
    expect(row.calls.buffSpeed).toBeUndefined();
  }
});

it("distinguishes all eight source buff profiles and mixed modifier order", () => {
  const source = { Rage: [135, 0], Freeze: [-100, 0], Poison: [0, 0], IceWizardSlowDown: [-35, 0],
    ZapFreeze: [-100, 0], Tornado: [0, 220], Clone: [-100, 0], Heal: [0, 0] };
  for (const [name, [speedMultiplier, attraction]] of Object.entries(source)) {
    const selected = rows.filter((r) => r.fields.buffs.length === 1 && r.fields.buffs[0].name === name);
    expect(selected).toHaveLength(9);
    for (const row of selected) {
      expect(row.fields.buffs[0]).toEqual({ name, speedMultiplier, attraction });
      if (row.fields.requestedDistance === 5000)
        expect(row.returned).toBe(Number(!attraction && (row.fields.activeClockMs > 0 || speedMultiplier > -100)));
    }
  }
  const mixed = rows.filter((r) => r.fields.buffs.map((b) => b.name).sort().join(",") === "IceWizardSlowDown,Rage");
  expect(mixed).toHaveLength(18);
  mixed.forEach(reconstruct);
});

it("retains integer speed truncation and rejects nonpositive initial controls", () => {
  const truncated = rows.filter((r) => r.fields.buffs.length === 1 &&
    r.fields.buffs[0].speedMultiplier === -99 && r.fields.buffs[0].attraction <= 0 && !r.fields.activeClockMs);
  expect(truncated).toHaveLength(2);
  for (const row of truncated) {
    expect(row.returned).toBe(0);
    expect(row.calls.buffSpeed).toBe(1);
    expect(row.calls.geometry).toBeUndefined();
  }
  const disabled = rows.filter((r) => r.fields.activeClockMs <= 0 && r.fields.cooldownMs <= 0);
  expect(disabled.length).toBeGreaterThan(0);
  for (const row of disabled) {
    expect(row.returned).toBe(0);
    expect(row.calls.dashEnabled).toBe(1);
    expect(row.calls.speed).toBeUndefined();
  }
});
