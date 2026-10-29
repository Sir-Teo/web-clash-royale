import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { attackFlight } from "../src/game/attack-flight";
import { attackHitSteps } from "./helpers/attack-hit-steps";
import { attackReach } from "../src/game/attack-range";
import { projectileMuzzle } from "../src/game/projectile-muzzle";
import {
  initializeRangeGoal,
  hasProjectileRange,
  projectileRangeEnd,
} from "../src/game/projectile-range";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import source from "../src/game/projectile-range-data.json";
import golden from "./fixtures/projectile-range-rules41-golden.json";
function match(version: Replay["version"] = 42) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 5017, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(
  b: Battle,
  card: CardId,
  team: Team,
  x = 4,
  y = team === "blue" ? 22 : 10,
) {
  const ids = new Set(b.entities.map((e) => e.id));
  if (card === "lava-pup") (b as any).spawn(card, team, x, y, false, 0);
  else {
    b.players[team].elixir = 10;
    b.players[team].hand[0] = card;
    expect(b.play(team, 0, x, y).ok).toBe(true);
  }
  return b.entities.filter((e) => !ids.has(e.id));
}
function scene(alias: string, team: Team, version: Replay["version"] = 42) {
  const b = match(version);
  let actor: Entity;
  if (
    alias.endsWith("-tower") &&
    ["king-tower", "princess-tower"].includes(alias)
  )
    actor = b.entities.find(
      (e) => e.team === team && !!e.king === (alias === "king-tower"),
    )!;
  else {
    const bodies = cast(b, alias as CardId, team);
    actor = bodies[0];
    for (const body of bodies.slice(1)) body.active = false;
  }
  Object.assign(actor, {
    x: 4,
    y: team === "blue" ? 22 : 10,
    deploy: 0,
    active: true,
    activation: 0,
    cooldown: 0,
    speed: 0,
    lifetime: undefined,
  });
  if (actor.card === "sparky") actor.sparkyCharge = 4.5;
  const enemy = team === "blue" ? "red" : "blue";
  const victim = cast(b, "cannon", enemy)[0];
  const reach = attackReach(actor, victim) - 0.05;
  Object.assign(victim, {
    x: actor.x + reach * 0.6,
    y: actor.y + (team === "blue" ? -1 : 1) * reach * 0.8,
    deploy: 0,
    active: false,
    hp: 1e6,
    maxHp: 1e6,
    speed: 0,
    lifetime: undefined,
  });
  actor.target = victim.id;
  return { b, actor, victim };
}
function digest(b: Battle) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (b as any)[key]]),
        ),
      ),
    )
    .digest("hex");
}
it("retains complete independently captured rules-41 worlds and audio", () => {
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (b as any).ai = true;
      (b as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (a) => a.team === "blue" && a.tick === b.tick,
          )) {
            expect(
              b.play(
                "blue",
                b.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
          }
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  }
});
it("pins range provenance and reproduces all 1,978 early and 144 late native destinations", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/projectile-range-manifest.json", "utf8"),
  );
  for (const file of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(file.path)).digest("hex"),
    ).toBe(file.sha256);
  const early = JSON.parse(
    readFileSync("reference/client/projectile-range-native-trace.json", "utf8"),
  );
  expect(early.sha256).toBe(manifest.nativeSha256);
  for (const row of [...early.cases, ...early.controls]) {
    const result = initializeRangeGoal(
      row.actorPresent ? row.actorPoint : undefined,
      row.callerStart,
      row.providedLaunch,
      row.providedGoal,
      row.fields,
    );
    expect(result.goal).toEqual(row.initializedGoal);
    expect(result.targetCleared).toBe(row.targetCleared);
  }
  const late = JSON.parse(
    readFileSync(
      "reference/client/projectile-flight-native-trace.json",
      "utf8",
    ),
  );
  for (const row of late.cases) {
    const goal = initializeRangeGoal(
      row.actorPresent ? row.actorPoint : undefined,
      row.callerStart,
      row.providedLaunch,
      row.providedGoal,
      row.fields,
    ).goal;
    expect(goal).toEqual(row.initialized.goal);
  }
  expect(Object.keys(source.ranges)).toEqual(["Bowler", "AxeMan"]);
});
for (const team of ["blue", "red"] as const)
  for (const card of ["bowler", "executioner"] as const)
    for (const lost of [false, true])
      it(`${team} ${card} uses native extension after ${lost ? "victim loss" : "a live attack"}`, () => {
        for (const distance of [1.5, 3, 4.8]) {
          const { b, actor, victim } = scene(card, team);
          Object.assign(victim, {
            x: actor.x + distance * 0.6,
            y: actor.y + (team === "blue" ? -1 : 1) * distance * 0.8,
          });
          for (let n = 0; n < 30 && !actor.pendingAttack; n++) b.step();
          expect(actor.pendingAttack).toBeDefined();
          if (lost) victim.hp = 0;
          const aim = lost
            ? { ...actor.pendingAttack!.lastPoint! }
            : { x: victim.x, y: victim.y };
          const flight = attackFlight(actor, aim)!;
          const forecast = attackHitSteps(actor, victim);
          const muzzle = projectileMuzzle(actor, aim)!;
          const f = source.ranges[card === "bowler" ? "Bowler" : "AxeMan"];
          const expected = initializeRangeGoal(
            { x: Math.round(actor.x * 1000), y: Math.round(actor.y * 1000) },
            { x: Math.round(muzzle.x * 1000), y: Math.round(muzzle.y * 1000) },
            { x: Math.round(muzzle.x * 1000), y: Math.round(muzzle.y * 1000) },
            { x: Math.round(aim.x * 1000), y: Math.round(aim.y * 1000) },
            f,
          ).goal;
          expect(actor.nativeProjectileRange).toBe(true);
          expect(flight.end).toEqual({
            x: expected.x / 1000,
            y: expected.y / 1000,
          });
          let shot;
          for (let n = 0; n < 100; n++) {
            b.step();
            shot = b.projectiles.find((p) => p.source === actor.id);
            if (shot) break;
          }
          expect(shot).toBeDefined();
          actor.active = false;
          expect({ x: shot!.tx, y: shot!.ty }).toEqual(flight.end);
          expect(shot!.target).toBeNull();
          expect(shot!.duration).toBeCloseTo(flight.duration, 12);
          const d = Math.hypot(
            flight.end.x - flight.start.x,
            flight.end.y - flight.start.y,
          );
          const travel = Math.min(d, flight.speed! * STEP);
          expect(shot!.flight!.x).toBeCloseTo(
            flight.start.x + ((flight.end.x - flight.start.x) / d) * travel,
            12,
          );
          expect(shot!.flight!.y).toBeCloseTo(
            flight.start.y + ((flight.end.y - flight.start.y) / d) * travel,
            12,
          );
          if (!lost) {
            let hitStep = 1;
            while (victim.hp === 1e6 && hitStep < 200) {
              b.step();
              hitStep++;
            }
            expect(hitStep).toBe(forecast);
          }
          for (
            let n = 0;
            n < 300 && b.projectiles.some((p) => p.id === shot!.id);
            n++
          )
            b.step();
          expect(b.projectiles.some((p) => p.id === shot!.id)).toBe(false);
          if (!lost)
            expect(victim.hp).toBe(
              1e6 - shot!.damage * (card === "executioner" ? 2 : 1),
            );
          expect(
            b.audioEvents.filter(
              (e) => e.actor === actor.id && e.phase === "launch",
            ),
          ).toHaveLength(1);
        }
      });
it("preserves rules-41 extensions and imports new unclamped edge endpoints", () => {
  for (const card of ["bowler", "executioner"] as const) {
    const old = scene(card, "blue", 41);
    const near = { x: old.actor.x + 0.9, y: old.actor.y - 1.2 };
    const flight = attackFlight(old.actor, near)!;
    expect(old.actor.nativeProjectileRange).toBeUndefined();
    const extent = card === "bowler" ? 6 : 4.5;
    const base = card === "bowler" ? flight.start : old.actor;
    expect(flight.end.x).toBeCloseTo(base.x + extent * 0.6, 12);
    expect(flight.end.y).toBeCloseTo(base.y - extent * 0.8, 12);
    const current = scene(card, "blue");
    Object.assign(current.actor, { x: 0.1, y: 0.1 });
    const aim = { x: -1, y: -1 };
    const extended = attackFlight(current.actor, aim)!;
    expect(extended.end.x).toBeLessThan(0);
    expect(extended.end.y).toBeLessThan(0);
    expect(hasProjectileRange(card)).toBe(true);
  }
  expect(hasProjectileRange("musketeer")).toBe(false);
  const { actor, victim } = scene("musketeer", "blue");
  expect(actor.nativeProjectileRange).toBeUndefined();
  expect(projectileRangeEnd(actor, victim, actor)).toBeUndefined();
});
it("retains range policies/goals through guest snapshots, Mirror and Clone", () => {
  for (const card of ["bowler", "executioner"] as const) {
    const { b, actor } = scene(card, "red");
    (b as any).releaseAttack(actor, undefined, actor.damage, {
      x: actor.x - 1.5,
      y: actor.y + 2,
    });
    const host = structuredClone(snapshot(b));
    const view = perspective(host, "red");
    expect(
      view.entities.find((e) => e.id === actor.id)!.nativeProjectileRange,
    ).toBe(true);
    for (const p of b.projectiles) {
      const rotated = view.projectiles.find((q) => q.id === p.id)!;
      expect(rotated.tx).toBeCloseTo(18 - p.tx, 12);
      expect(rotated.ty).toBeCloseTo(32 - p.ty, 12);
    }
    const guest = match(41);
    applySnapshot(guest, host, "red");
    expect(
      guest.entities.find((e) => e.id === actor.id)!.nativeProjectileRange,
    ).toBe(true);
    applySnapshot(guest, snapshot(match(41)), "red");
    expect(guest.entities.every((e) => !e.nativeProjectileRange)).toBe(true);
    const fresh = scene(card, "blue");
    const mirror = cast(fresh.b, "mirror", "blue", 8)[0];
    expect(mirror.card).toBe(card);
    expect(mirror.nativeProjectileRange).toBe(true);
    cast(fresh.b, "clone", "blue", fresh.actor.x, fresh.actor.y);
    fresh.b.step();
    const clone = fresh.b.entities.find((e) => e.clone && e.card === card)!;
    expect(clone.nativeProjectileRange).toBe(true);
    expect(clone.pendingAttack).toBeUndefined();
  }
});
for (const [index, card] of [
  [0, "bowler"],
  [1, "executioner"],
] as const)
  it(`records and replays a complete current game with source ${card} range`, () => {
    const row = golden.cases[index];
    const b = new Battle({ replay: { ...row.replay, version: 42 } as Replay });
    let used = false;
    for (let n = 0; n < 12000 && !b.winner; n++) {
      b.step();
      used ||= b.projectiles.some(
        (p) =>
          p.style === card &&
          b.entities.find((e) => e.id === p.source)?.nativeProjectileRange,
      );
    }
    expect(used).toBe(true);
    expect(b.winner).toBeTruthy();
    const replay = new Battle({ replay: b.exportReplay() });
    for (let n = 0; n < b.tick; n++) replay.step();
    expect(replay.rulesVersion).toBe(42);
    expect(digest(replay)).toBe(digest(b));
  });
