import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Replay,
  type Entity,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import { sparkyLoadRate } from "../src/game/sparky-preload";
import source from "../src/game/sparky-preload-data.json";
import golden from "./fixtures/sparky-preload-rules36-golden.json";
const native = JSON.parse(
  readFileSync("reference/client/preload-transition-native-trace.json", "utf8"),
);
const modes = [
  { name: "normal", buffs: [], rate: 1 },
  { name: "rage", buffs: ["Rage"], rate: 67 / 50 },
  { name: "slow", buffs: ["IceWizardSlowDown"], rate: 32 / 50 },
  { name: "both", buffs: ["Rage", "IceWizardSlowDown"], rate: 43 / 50 },
];
function match(version: Replay["version"] = 37) {
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
  version: Replay["version"],
  team: Team,
  mode: (typeof modes)[number],
  active = false,
) {
  const b = match(version),
    actor = cast(b, "sparky", team, 4, team === "blue" ? 22 : 10)[0];
  actor.deploy = 0;
  actor.cooldown = 4.5;
  actor.speed = 0;
  actor.rage = mode.buffs.includes("Rage") ? { remaining: 100 } : undefined;
  actor.slow = mode.buffs.includes("IceWizardSlowDown")
    ? { remaining: 100 }
    : undefined;
  const target = b.entities.find(
    (e) => e.kind === "tower" && !e.king && e.team !== team && e.x < 9,
  )!;
  target.hp = target.maxHp = 100000;
  if (active) {
    target.x = actor.x;
    target.y = actor.y + (team === "blue" ? -3 : 3);
  }
  return { b, actor, target };
}
function warm(b: Battle) {
  for (let n = 0; n < 90; n++) b.step();
}
it("pins native passive witnesses and source/output hashes", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/sparky-preload-manifest.json", "utf8"),
  );
  for (const input of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(source).toEqual({ stepMs: 50, passiveRate: 1 });
  expect(manifest.nativeSha256).toBe(native.sha256);
  for (const row of native.cases.filter(
    (r: any) =>
      r.sourceName === "ZapMachine" && r.scenario !== "range-true-owner1",
  )) {
    const end = row.checkpoints.find(
      (p: any) => p.tick === row.warmSteps && p.phase === "update",
    );
    expect(end.reloadMs).toBe(Math.max(0, row.loadTimeMs - row.warmSteps * 50));
    expect(end.elapsedMs).toBe(0);
    expect(
      sparkyLoadRate(
        { nativeSparkyPreload: true },
        false,
        modes.find(
          (m) => JSON.stringify(m.buffs) === JSON.stringify(row.buffs),
        )!.rate,
      ),
    ).toBe(1);
  }
});
for (const team of ["blue", "red"] as const)
  for (const mode of modes) {
    it(`uses real-time passive ${mode.name} preload for ${team}`, () => {
      const current = scene(37, team, mode),
        old = scene(36, team, mode);
      const rng = (current.b as any).randomState;
      warm(current.b);
      warm(old.b);
      expect(current.actor.sparkyCharge).toBeCloseTo(3, 10);
      expect(current.actor.cooldown).toBeCloseTo(1.5, 10);
      expect(old.actor.sparkyCharge).toBeCloseTo(3 * mode.rate, 10);
      expect(old.actor.cooldown).toBeCloseTo(4.5 - 3 * mode.rate, 10);
      expect(current.actor.nativeSparkyPreload).toBe(true);
      expect(old.actor.nativeSparkyPreload).toBeUndefined();
      expect((current.b as any).randomState).toBe(rng);
      expect(
        current.b.audioEvents
          .filter((e) => e.profile === "sparky" && e.phase.startsWith("load-"))
          .map((e) => e.phase),
      ).toEqual(["load-1", "load-2"]);
    });
    it(`retains active ${mode.name} attack clocks for ${team}`, () => {
      const current = scene(37, team, mode, true),
        old = scene(36, team, mode, true);
      warm(current.b);
      warm(old.b);
      expect(current.actor.sparkyCharge).toBeCloseTo(
        old.actor.sparkyCharge!,
        12,
      );
      expect(current.actor.cooldown).toBeCloseTo(old.actor.cooldown, 12);
      expect(current.actor.sparkyCharge).toBeCloseTo(3 * mode.rate, 10);
      expect(
        current.b.audioEvents
          .filter((e) => e.profile === "sparky")
          .map((e) => e.phase),
      ).toEqual(
        old.b.audioEvents
          .filter((e) => e.profile === "sparky")
          .map((e) => e.phase),
      );
    });
    it(`transitions from passive ${mode.name} preload to an actual ${team} shot`, () => {
      const { b, actor, target } = scene(37, team, mode);
      warm(b);
      target.x = actor.x;
      target.y = actor.y + (team === "blue" ? -3 : 3);
      const start = b.tick;
      while (
        b.tick < start + 240 &&
        !b.projectiles.some(
          (p) => p.source === actor.id && p.style === "sparky",
        )
      )
        b.step();
      expect(
        b.projectiles.some(
          (p) => p.source === actor.id && p.style === "sparky",
        ),
      ).toBe(true);
      const row = native.cases.find(
        (r: any) =>
          r.sourceName === "ZapMachine" &&
          r.scenario === "no-target-owner1" &&
          r.warmSteps === 60 &&
          JSON.stringify(r.buffs) === JSON.stringify(mode.buffs),
      );
      const pulse = row.pulses.find((p: any) => p.tick > 60);
      const nativeDelay = ((pulse.tick - 60) * source.stepMs) / 1000;
      const actualDelay = (b.tick - start) * STEP;
      expect(Math.abs(actualDelay - nativeDelay)).toBeLessThanOrEqual(
        0.05 / mode.rate + 2 * STEP + 1e-8,
      );
    });
  }
it("keeps a fully preloaded passive Sparky ready under slow", () => {
  const { b, actor } = scene(37, "blue", modes[2]);
  for (let n = 0; n < 180; n++) b.step();
  expect(actor.sparkyCharge).toBe(4.5);
  expect(actor.cooldown).toBe(0);
  expect(b.projectiles).toEqual([]);
  expect(
    b.audioEvents
      .filter((e) => e.profile === "sparky" && e.phase.startsWith("load-"))
      .map((e) => e.phase),
  ).toEqual(["load-1", "load-2", "load-3", "load-ready"]);
});
it("preserves stun recharge and restarts passive loading in real time", () => {
  const { b, actor } = scene(37, "blue", modes[1]);
  warm(b);
  actor.stun = 0.5;
  b.step();
  expect(actor.sparkyCharge).toBe(0);
  expect(actor.cooldown).toBe(4.5);
  while (actor.stun > 0) b.step();
  const before = actor.sparkyCharge!;
  for (let n = 0; n < 30; n++) b.step();
  expect(actor.sparkyCharge! - before).toBeCloseTo(1, 10);
});
it("preserves Mirror initialization and Clone charge for rotated guests", () => {
  const { b, actor } = scene(37, "blue", modes[1]);
  warm(b);
  b.players.blue.lastPlayed = "sparky";
  const mirrored = cast(b, "mirror", "blue", 14, 22)[0];
  expect(mirrored.nativeSparkyPreload).toBe(true);
  expect(mirrored.sparkyCharge).toBe(0);
  const clonedCharge = actor.sparkyCharge;
  cast(b, "clone", "blue", actor.x, actor.y);
  b.step();
  const clone = b.entities.find((e) => e.clone && e.card === "sparky")!;
  expect(clone.nativeSparkyPreload).toBe(true);
  expect(clone.sparkyCharge).toBe(clonedCharge);
  const original = JSON.stringify(snapshot(b));
  const guest = match(36);
  applySnapshot(guest, snapshot(b), "red");
  expect(guest.entities.find((e) => e.id === actor.id)).toMatchObject({
    nativeSparkyPreload: true,
    sparkyCharge: actor.sparkyCharge,
  });
  expect(JSON.stringify(snapshot(b))).toBe(original);
  expect(
    perspective(perspective(snapshot(b), "red"), "red").entities.find(
      (e) => e.id === actor.id,
    )?.nativeSparkyPreload,
  ).toBe(true);
});
it("does not add the preload policy to older bodies or ordinary troops", () => {
  for (const version of [5, 19, 28, 35, 36] as const) {
    const b = match(version);
    expect(
      cast(b, "sparky", "blue", 4, 22)[0].nativeSparkyPreload,
    ).toBeUndefined();
  }
  const b = match();
  expect(
    cast(b, "knight", "blue", 4, 22)[0].nativeSparkyPreload,
  ).toBeUndefined();
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
it("preserves whole rules-36 worlds, including actual Sparky attacks and historical AI", () => {
  expect(golden.sourceCommit).toBe("9ea4dac");
  expect(golden.cases.some((r) => r.deployed.includes("sparky"))).toBe(true);
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
it("records and replays a complete current game containing Sparky", () => {
  const old = golden.cases.find((r) => r.deployed.includes("sparky"))!.replay;
  const b = new Battle({
    replay: { ...old, version: 37, actions: [], duration: 12000 } as Replay,
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
      (e) => e.card === "sparky" && e.nativeSparkyPreload,
    );
    if (b.tick % 300 === 0 || b.winner)
      checkpoints.push({ tick: b.tick, digest: digest(b) });
  }
  expect(b.winner).toBeTruthy();
  expect(loaded).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  expect(replay.rulesVersion).toBe(37);
  for (const p of checkpoints) {
    while (replay.tick < p.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(p.digest);
  }
});
