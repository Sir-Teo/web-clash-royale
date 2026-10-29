import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { attackReach, minimumAttackDistance } from "../src/game/attack-range";
import { hasPendingRange, pendingAttackReach } from "../src/game/pending-range";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import source from "../src/game/pending-range-data.json";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import golden from "./fixtures/pending-range-rules37-golden.json";
const native = JSON.parse(
  readFileSync("reference/client/pending-range-native-trace.json", "utf8"),
);
function match(version: Replay["version"] = 38) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 1907, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(b: Battle, card: CardId, team: Team, x: number, y: number) {
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  const ids = new Set(b.entities.map((e) => e.id));
  expect(b.play(team, 0, x, y).ok).toBe(true);
  return b.entities.filter((e) => !ids.has(e.id));
}
function scene(
  card: CardId,
  team: Team,
  version: Replay["version"] = 38,
  targetCard: CardId = "knight",
) {
  const b = match(version),
    y = team === "blue" ? 22 : 10;
  const actors = cast(b, card, team, 4, team === "blue" ? 22 : 10);
  const actor = actors[0];
  for (const other of actors.slice(1)) other.hp = 0;
  Object.assign(actor, { x: 4, y, speed: 0, deploy: 0, cooldown: 0 });
  if (card === "sparky") actor.sparkyCharge = 4.5;
  const target = cast(
    b,
    targetCard,
    team === "blue" ? "red" : "blue",
    4,
    team === "blue" ? 10 : 22,
  )[0];
  Object.assign(target, {
    x: 4,
    y,
    active: false,
    deploy: 0,
    hp: 100000,
    maxHp: 100000,
    speed: 0,
  });
  const direction = team === "blue" ? -1 : 1;
  target.y = y + direction * (attackReach(actor, target) - 0.01);
  b.step();
  expect(actor.pendingAttack?.target).toBe(target.id);
  return { b, actor, target, direction };
}
it("pins source hashes and reproduces all 1512 native range decisions", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/pending-range-manifest.json", "utf8"),
  );
  for (const input of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(source.extraRange).toBe(0.5);
  for (const row of [...native.cases, ...native.controls]) {
    const body = {
      range: row.baseReach / 1000,
      radius: 0,
      interval: row.intervalMs / 1000,
      nativePendingRange:
        row.preserveStarted && row.hasProjectile ? (true as const) : undefined,
      pendingAttack: {
        target: 1,
        damage: 1,
        remaining: (row.intervalMs - row.elapsedMs) / 1000,
      },
    };
    expect(
      row.targetOffsetX / 1000 <= pendingAttackReach(body, { radius: 0 }),
      JSON.stringify(row),
    ).toBe(row.computedInRange);
  }
});
it("keeps the strict 50ms gate through decimal subtraction and interval wrapping", () => {
  const body = {
    range: 5,
    radius: 0.5,
    rangeRadiusFactor: 1,
    interval: 0.8,
    nativePendingRange: true as const,
    pendingAttack: { target: 1, damage: 1, remaining: 0.75 },
  };
  expect(pendingAttackReach(body, { radius: 0 })).toBe(5.5);
  body.pendingAttack.remaining = 0.749;
  expect(pendingAttackReach(body, { radius: 0 })).toBe(6);
  body.pendingAttack.remaining = -0.05;
  expect(pendingAttackReach(body, { radius: 0 })).toBe(5.5);
  body.pendingAttack.remaining = -0.051;
  expect(pendingAttackReach(body, { radius: 0 })).toBe(6);
  expect(pendingAttackReach({ ...body, interval: 0 }, { radius: 0 })).toBe(5.5);
  expect(
    pendingAttackReach({ ...body, pendingAttack: undefined }, { radius: 0 }),
  ).toBe(5.5);
});
for (const team of ["blue", "red"] as const) {
  for (const card of [
    "musketeer",
    "archers",
    "cannon",
    "sparky",
    "bowler",
    "executioner",
    "mortar",
    "x-bow",
    "princess",
  ] as const)
    it(`${team} ${card} releases its started projectile at the extra half-tile edge`, () => {
      const { b, actor, target, direction } = scene(card, team);
      // Zero-LoadTime bodies must advance beyond the native startup guard.
      while (
        actor.pendingAttack &&
        actor.interval - actor.pendingAttack.remaining <= 0.051
      )
        b.step();
      expect(actor.nativePendingRange).toBe(true);
      target.x = actor.x;
      target.y = actor.y + direction * (attackReach(actor, target) + 0.5);
      const diagnostic = {
        gap: Math.hypot(actor.x - target.x, actor.y - target.y),
        reach: pendingAttackReach(actor, target),
        remaining: actor.pendingAttack?.remaining,
        interval: actor.interval,
      };
      const hp = target.hp;
      let retained = false;
      for (let n = 0; n < 150 && target.hp === hp; n++) {
        const before = actor.pendingAttack?.remaining;
        b.step();
        retained ||=
          before !== undefined &&
          !!actor.pendingAttack &&
          actor.pendingAttack.remaining < before;
      }
      expect(retained, JSON.stringify(diagnostic)).toBe(true);
      expect(target.hp).toBeLessThan(hp);
    });
  for (const mode of ["normal", "rage", "slow", "both"] as const)
    it(`${team} ${mode} retains a pending ranged shot while its active windup advances`, () => {
      const { b, actor, target, direction } = scene("musketeer", team);
      actor.rage =
        mode === "rage" || mode === "both" ? { remaining: 100 } : undefined;
      actor.slow =
        mode === "slow" || mode === "both" ? { remaining: 100 } : undefined;
      target.x = actor.x;
      target.y = actor.y + direction * (attackReach(actor, target) + 0.499);
      const remaining = actor.pendingAttack!.remaining;
      b.step();
      const rate =
        mode === "rage"
          ? 67 / 50
          : mode === "slow"
            ? 32 / 50
            : mode === "both"
              ? 43 / 50
              : 1;
      expect(actor.pendingAttack!.remaining).toBeCloseTo(
        remaining - STEP * rate,
        12,
      );
      for (let n = 0; n < 90 && target.hp === target.maxHp; n++) b.step();
      expect(target.hp).toBeLessThan(target.maxHp);
    });
  it(`${team} Sparky keeps its loaded building shot when a closer defender appears`, () => {
    const { b, actor, target, direction } = scene("sparky", team, 38, "cannon");
    target.x = actor.x;
    target.y = actor.y + direction * (attackReach(actor, target) + 0.49);
    const defender = cast(
      b,
      "knight",
      team === "blue" ? "red" : "blue",
      4,
      team === "blue" ? 10 : 22,
    )[0];
    Object.assign(defender, {
      x: actor.x + 1,
      y: actor.y + direction * 2,
      active: false,
      deploy: 0,
    });
    b.step();
    expect(actor.pendingAttack?.target).toBe(target.id);
    expect(actor.target).toBe(target.id);
  });
  for (const version of [37, 38] as const)
    it(`${team} rules ${version} cancels beyond the allowed range`, () => {
      const { b, actor, target, direction } = scene("musketeer", team, version);
      target.y =
        actor.y +
        direction *
          (attackReach(actor, target) + (version === 38 ? 0.501 : 0.001));
      b.step();
      expect(actor.pendingAttack).toBeUndefined();
      expect(target.hp).toBe(target.maxHp);
    });
  it(`${team} Cannon cannot use extra reach during the first 50ms`, () => {
    const { b, actor, target, direction } = scene("cannon", team);
    target.y = actor.y + direction * (attackReach(actor, target) + 0.001);
    b.step();
    expect(actor.pendingAttack).toBeUndefined();
  });
  it(`${team} Mortar still cancels inside its minimum distance`, () => {
    const { b, actor, target, direction } = scene("mortar", team);
    target.y =
      actor.y + direction * (minimumAttackDistance(actor, target) - 0.001);
    b.step();
    expect(actor.pendingAttack).toBeUndefined();
  });
  it(`${team} dead targets and changed allegiance cancel a started attack`, () => {
    for (const death of [true, false]) {
      const { b, actor, target } = scene("musketeer", team);
      if (death) target.hp = 0;
      else target.team = team;
      b.step();
      expect(actor.pendingAttack).toBeUndefined();
    }
  });
}
it("uses source projectile presence for troops, buildings and Crowns", () => {
  const b = match();
  expect(
    b.entities
      .filter((e) => e.kind === "tower")
      .every((e) => e.nativePendingRange),
  ).toBe(true);
  for (const card of [
    "knight",
    "balloon",
    "electro-wizard",
    "inferno-dragon",
    "inferno-tower",
  ] as const)
    expect(cast(b, card, "blue", 4, 22)[0].nativePendingRange).toBe(
      hasPendingRange(card) ? true : undefined,
    );
  for (const version of [5, 19, 28, 35, 36, 37] as const) {
    const old = match(version);
    expect(old.entities.every((e) => e.nativePendingRange === undefined)).toBe(
      true,
    );
    expect(
      cast(old, "musketeer", "blue", 4, 22)[0].nativePendingRange,
    ).toBeUndefined();
  }
});
it("retains the policy and pending attack across snapshots and a rotated guest", () => {
  const { b, actor } = scene("musketeer", "blue");
  const original = JSON.stringify(snapshot(b));
  const guest = match(37);
  applySnapshot(guest, snapshot(b), "red");
  expect(guest.entities.find((e) => e.id === actor.id)).toMatchObject({
    nativePendingRange: true,
    pendingAttack: actor.pendingAttack,
  });
  expect(
    perspective(perspective(snapshot(b), "red"), "red").entities.find(
      (e) => e.id === actor.id,
    )?.nativePendingRange,
  ).toBe(true);
  expect(JSON.stringify(snapshot(b))).toBe(original);
  applySnapshot(guest, snapshot(match(37)), "blue");
  expect(guest.entities.every((e) => e.nativePendingRange === undefined)).toBe(
    true,
  );
});
it("gives Mirror fresh pending state and Clone the source projectile policy", () => {
  const { b, actor } = scene("musketeer", "blue");
  b.players.blue.lastPlayed = "musketeer";
  const mirrored = cast(b, "mirror", "blue", 14, 22)[0];
  expect(mirrored.nativePendingRange).toBe(true);
  expect(mirrored.pendingAttack).toBeUndefined();
  cast(b, "clone", "blue", actor.x, actor.y);
  b.step();
  const clone = b.entities.find((e) => e.clone && e.card === "musketeer")!;
  expect(clone.nativePendingRange).toBe(true);
  expect(clone.pendingAttack).toBeUndefined();
});
it("keeps an extra-reach King shot in the fatal-windup forecast", () => {
  const { b, actor, target } = scene("musketeer", "blue");
  target.hp = 0;
  const king = b.entities.find((e) => e.team === "red" && e.king)!;
  king.x = actor.x;
  king.y = actor.y - attackReach(actor, king) - 0.499;
  actor.pendingAttack!.target = king.id;
  actor.pendingAttack!.damage = king.hp;
  expect(
    fatalKingWindups("red", b.entities).some(
      (row) => row.attacker.id === actor.id,
    ),
  ).toBe(true);
  for (let n = 0; n < 90 && king.hp > 0; n++) b.step();
  expect(king.hp).toBe(0);
});
for (const team of ["blue", "red"] as const)
  for (const king of [false, true])
    it(`${team} ${king ? "King" : "Princess"} retains a started Crown projectile at the extended boundary`, () => {
      const b = match(),
        actor = b.entities.find(
          (e) => e.team === team && e.kind === "tower" && !!e.king === king,
        )!;
      Object.assign(actor, {
        x: team === "blue" ? 4 : 14,
        y: team === "blue" ? 22 : 10,
        active: true,
        cooldown: 0,
      });
      const target = cast(
        b,
        "knight",
        team === "blue" ? "red" : "blue",
        actor.x,
        team === "blue" ? 10 : 22,
      )[0];
      Object.assign(target, {
        x: actor.x,
        active: false,
        hp: 100000,
        maxHp: 100000,
        deploy: 0,
      });
      const direction = team === "blue" ? -1 : 1;
      target.y = actor.y + direction * (attackReach(actor, target) - 0.01);
      for (let n = 0; n < 4; n++) b.step();
      expect(actor.pendingAttack?.target).toBe(target.id);
      target.y = actor.y + direction * (attackReach(actor, target) + 0.5);
      for (let n = 0; n < 90 && target.hp === target.maxHp; n++) b.step();
      expect(target.hp).toBeLessThan(target.maxHp);
    });
const digest = (b: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (b as any)[key]]),
        ),
      ),
    )
    .digest("hex");
it("preserves complete rules-37 games and historical AI", () => {
  expect(golden.sourceCommit).toBe("89b21b7");
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
          ))
            expect(
              b.play(
                "blue",
                b.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  }
});
it("records and replays a complete current game with projectile attacks", () => {
  const old = golden.cases.find((r) => r.deployed.includes("sparky"))!.replay;
  const b = new Battle({
    replay: { ...old, version: 38, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints = [];
  let loaded = false;
  while (!b.winner && b.tick < 12000) {
    for (const action of old.actions.filter((a) => a.tick === b.tick)) {
      const team = action.team as Team,
        slot = b.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) b.play(team, slot, action.x, action.y);
    }
    b.step();
    loaded ||= b.entities.some(
      (e) => e.card !== "tower" && e.nativePendingRange && e.pendingAttack,
    );
    if (b.tick % 300 === 0 || b.winner)
      checkpoints.push({ tick: b.tick, digest: digest(b) });
  }
  expect(b.winner).toBeTruthy();
  expect(loaded).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  expect(replay.rulesVersion).toBe(38);
  for (const p of checkpoints) {
    while (replay.tick < p.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(p.digest);
  }
});
