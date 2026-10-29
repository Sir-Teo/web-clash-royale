import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const trace = JSON.parse(readFileSync("reference/client/ordinary-delivery-native-trace.json", "utf8"));
const rows = [...trace.cases, ...trace.controls];

it("pins selected ordinary delivery to the native source and complete transition prerequisites", () => {
  expect(trace.sha256).toBe("c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746");
  for (const input of trace.inputs)
    expect(createHash("sha256").update(readFileSync(input.path)).digest("hex")).toBe(input.sha256);
  expect(trace.profiles).toEqual({ attacker: "Assassin", target: "Knight", sourceAmount: 160,
    initialTargetHp: 1000, areaDamageRadius: 0, chargeRange: 0, crownTowerDamagePercent: 0,
    sourceEffect: "assassin_hit" });
  expect(trace.cases).toHaveLength(16);
  expect(trace.controls).toHaveLength(76);
  expect(trace.blocks).toHaveLength(8);
  expect(trace.limits.join(" ")).toContain("Packet/level selection");
  expect(trace.limits.join(" ")).toContain("Gameplay remains rules 53");
});

it("independently reconstructs all selected packets, ordered events, Data reads and driver inventories", () => {
  for (const row of rows) {
    const f = row.fields;
    const delta = f.cached.map((v: number, i: number) => v - f.origin[i]);
    const accepted = f.targetPresent && ![4, 9].includes(f.targetState) && f.amount > 0;
    const events: unknown[][] = [["ordinaryHeader", f.targetPresent], ["providedSelectedPacket", f.amount, f.sourcePresent]];
    if (!f.effectPresent) events.push(["providedOpaqueWord", 137]);
    if (f.targetPresent) {
      events.push(["providedTargetFacing", ...delta, 0], ["ordinaryReceiver", f.amount, f.effectWord, ...delta]);
      if (accepted) {
        if (f.sourcePresent) events.push(["providedSourceDamageView"]);
        events.push(["targetHp", 1000 - f.amount]);
      }
    }
    events.push(["afterOrdinaryDelivery", f.targetPresent]);
    const calls: Record<string, number> = {}, selectedCalls: Record<string, number> = {
      ordinaryHeader: 1, selectedMeleeTail: 1, singleTargetBranch: 1 };
    if (f.targetPresent) {
      Object.assign(calls, { healthComponent: 1, ordinaryHit: 1, providedViewNotification: 1 });
      Object.assign(selectedCalls, { directionConstructor: 1, ordinaryReceiver: 1 });
    }
    if (accepted) {
      Object.assign(calls, { buffComponent: 1, lowerDamageProxy: 1, damageReducer: 1 });
      if (f.sourcePresent) { calls.providedViewNotification++; selectedCalls.sourceParent = 1; }
    }
    expect(row.result, JSON.stringify(f)).toEqual({ targetHp: accepted ? 1000 - f.amount : 1000,
      applied: accepted, direction: f.targetPresent ? delta : null, events, calls, selectedCalls,
      dataReads: ["0x50", "0xbc", "0x19c", "0x1ac", "0x1b4"].map((offset) => ({ offset, size: 4 })),
      exactHeapChangesOnly: true });
  }
  expect(rows.filter((r) => r.result.applied)).toHaveLength(68);
  expect(rows.filter((r) => r.fields.targetPresent)).toHaveLength(88);
});

it("delivers the supplied source packet to near and distant selected targets in eight directions", () => {
  for (const row of trace.cases) {
    expect(row.fields.amount).toBe(160);
    expect([1750, 5000]).toContain(row.fields.distanceUnits);
    expect(row.result.targetHp).toBe(840);
    expect(row.result.calls.damageReducer).toBe(1);
  }
  const distances = rows.filter((r) => r.fields.kind === "distance");
  expect(distances).toHaveLength(24);
  expect([...new Set(distances.map((r) => r.fields.distanceUnits))]).toEqual([0, 1850, 1851, 3000, 6500, 7500]);
  expect(distances.every((r) => r.result.targetHp === 840)).toBe(true);
});

it("uses cached coordinates for the actual direction buffer while damaging the selected receiver", () => {
  const stale = rows.filter((r) => r.fields.kind === "cached-point");
  expect(stale).toHaveLength(8);
  for (const row of stale) {
    expect(Math.hypot(...row.result.direction)).toBe(1750);
    expect(Math.hypot(...row.fields.target.map((v: number, i: number) => v - row.fields.origin[i]))).toBe(5000);
    expect(row.result.targetHp).toBe(840);
    expect(row.result.selectedCalls.directionConstructor).toBe(1);
  }
});

it("rejects raw protected target states before lower damage and source-view work", () => {
  const protectedRows = rows.filter((r) => r.fields.kind === "state");
  expect(protectedRows).toHaveLength(16);
  for (const row of protectedRows) {
    expect([4, 9]).toContain(row.fields.targetState);
    expect(row.result.targetHp).toBe(1000);
    expect(row.result.calls.ordinaryHit).toBe(1);
    expect(row.result.calls.lowerDamageProxy).toBeUndefined();
    expect(row.result.events.some((e: unknown[]) => e[0] === "providedTargetFacing")).toBe(true);
    expect(row.result.events.some((e: unknown[]) => e[0] === "providedSourceDamageView")).toBe(false);
  }
});

it("distinguishes absent selected targets from absent packet source references", () => {
  for (const row of rows.filter((r) => r.fields.kind === "missing-target")) {
    expect(row.result.targetHp).toBe(1000);
    expect(row.result.direction).toBeNull();
    expect(row.result.calls).toEqual({});
  }
  for (const row of rows.filter((r) => r.fields.kind === "missing-source")) {
    expect(row.result.targetHp).toBe(840);
    expect(row.result.calls.damageReducer).toBe(1);
    expect(row.result.selectedCalls.sourceParent).toBeUndefined();
    expect(row.result.events.some((e: unknown[]) => e[0] === "providedSourceDamageView")).toBe(false);
  }
});

it("keeps supplied packet amounts separate from source level selection", () => {
  const amounts = rows.filter((r) => r.fields.kind === "amount");
  expect(amounts).toHaveLength(16);
  for (const row of amounts) {
    expect([0, 1, 194, 450]).toContain(row.fields.amount);
    expect(row.result.targetHp).toBe(1000 - row.fields.amount);
    expect(!!row.result.calls.damageReducer).toBe(row.fields.amount > 0);
  }
  expect(trace.limits.join(" ")).toContain("Packet/level selection");
  expect(trace.limits.join(" ")).toContain("shields, lethal paths");
});

it("preserves supplied effect references and checked fallback words through the receiver boundary", () => {
  for (const row of rows) {
    expect(row.fields.effectWord).toBe(row.fields.effectPresent ? 0x100D800 : 137);
    const packet = row.result.events.find((e: unknown[]) => e[0] === "ordinaryReceiver");
    if (row.fields.targetPresent) expect(packet[2]).toBe(row.fields.effectWord);
    else expect(packet).toBeUndefined();
  }
  const fallback = rows.filter((r) => r.fields.kind === "fallback-effect");
  expect(fallback).toHaveLength(4);
  expect(fallback.every((r) => r.result.targetHp === 840)).toBe(true);
  expect(trace.limits.join(" ")).toContain("view notifications are checked providers");
});
