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
import type { CardId } from "../src/game/cards";
import { attackFlight, attackHitSteps } from "../src/game/attack-flight";
import { attackReach } from "../src/game/attack-range";
import { pendingKingPackets } from "../src/game/king-defense";
import { fatalKingWindups } from "../src/game/king-spell-race";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import golden from "./fixtures/projectile-step-rules42-golden.json";

function match(version: Replay["version"] = 43) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 5017, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function spawn(b: Battle, card: CardId, team: Team) {
  (b as any).spawn(card, team, 4, team === "blue" ? 22 : 10, false, 0);
  return b.entities.at(-1)!;
}
function scene(
  card: CardId | "king-tower" | "princess-tower",
  team: Team,
  version: Replay["version"] = 43,
  kingVictim = false,
) {
  const b = match(version);
  const actor =
    card === "king-tower" || card === "princess-tower"
      ? b.entities.find(
          (e) => e.team === team && !!e.king === (card === "king-tower"),
        )!
      : spawn(b, card, team);
  const enemy = team === "blue" ? "red" : "blue";
  const victim = kingVictim
    ? b.entities.find((e) => e.team === enemy && e.king)!
    : spawn(b, "cannon", enemy);
  Object.assign(actor, {
    x: 4,
    y: team === "blue" ? 22 : 10,
    active: true,
    activation: 0,
    cooldown: 100,
    speed: 0,
    lifetime: undefined,
    deploy: 0,
  });
  if (actor.burrow) actor.burrow = { phase: "exposed", exposure: 1, idle: 0 };
  const distance = Math.max(0.1, attackReach(actor, victim) - 0.05);
  Object.assign(victim, {
    x: actor.x + distance * 0.6,
    y: actor.y + (team === "blue" ? -1 : 1) * distance * 0.8,
    active: false,
    deploy: 0,
    hp: 1e6,
    maxHp: 1e6,
    speed: 0,
    lifetime: undefined,
  });
  actor.target = victim.id;
  actor.pendingAttack = {
    target: victim.id,
    remaining: STEP,
    damage: actor.damage,
  };
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

it("retains independently captured complete rules-42 worlds, RNG and audio", () => {
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) Object.assign(b, { ai: true, replayActions: null });
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

it("binds the native manager snapshot rule to every captured birth and body visit", () => {
  const bytes = readFileSync("reference/client/world-step-native-trace.json");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "7b777a4580d19b4cbe1895c5281b7dbcfaed70e3e0c703030184ff54da8c5616",
  );
  const trace = JSON.parse(bytes.toString());
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
  for (const input of trace.inputs)
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(trace.cases).toHaveLength(24);
  expect(trace.controls).toHaveLength(30);
  const phases = new Set<string>();
  let births = 0,
    updates = 0,
    steps = 0;
  for (const row of [...trace.cases, ...trace.controls]) {
    for (const frame of row.frames) {
      steps++;
      expect(frame.unrelatedHeapUnchanged).toBe(true);
      for (const event of frame.events) {
        if (event[0] === "projectileUpdate") {
          updates++;
          expect(frame.snapshot).toContain(event[1]);
        }
        if (event[0] !== "birth") continue;
        births++;
        const [, pointer, phase] = event;
        phases.add(phase);
        const shot = frame.projectiles.find((p: any) => p.pointer === pointer);
        expect(shot).toBeDefined();
        if (phase === "pre") expect(frame.snapshot).toContain(pointer);
        else {
          expect(frame.snapshot).not.toContain(pointer);
          expect(
            frame.events.some(
              (e: any) => e[0] === "projectileUpdate" && e[1] === pointer,
            ),
          ).toBe(false);
          expect(shot.position).toEqual(row.providedMuzzle);
          expect(shot.previous).toEqual(row.providedMuzzle);
          const next = row.frames.find((f: any) => f.frame === frame.frame + 1);
          if (next)
            expect(next.events).toContainEqual(["projectileUpdate", pointer]);
        }
      }
    }
  }
  expect([...phases].sort()).toEqual(["attack", "body", "component", "pre"]);
  expect({ births, updates, steps }).toEqual({
    births: 100,
    updates: 2880,
    steps: 2592,
  });
});

for (const team of ["blue", "red"] as const)
  for (const card of [
    "archers",
    "musketeer",
    "cannon",
    "princess",
    "king-tower",
    "princess-tower",
    "baby-dragon",
    "bowler",
    "executioner",
    "tesla",
    "sparky",
    "balloon",
  ] as const)
    it(`${team} ${card} holds every new shot at its muzzle, then advances and hits on its forecast step`, () => {
      const { b, actor, victim } = scene(card, team);
      const expected = attackFlight(actor, victim)!;
      const hit = attackHitSteps(actor, victim);
      b.step();
      const shots = b.projectiles.filter((p) => p.source === actor.id);
      expect(shots).toHaveLength(card === "princess" ? 5 : 1);
      expect(victim.hp).toBe(1e6);
      for (const p of shots) {
        expect(p.elapsed).toBe(0);
        expect(p.remaining).toBe(p.duration);
        expect(p.flight).toEqual(
          p.decorative
            ? attackFlight(actor, { x: p.tx, y: p.ty })!.start
            : expected.start,
        );
      }
      expect(shots[0].flight).toEqual(expected.start);
      actor.active = false;
      b.step();
      expect(shots[0].elapsed).toBe(STEP);
      if (expected.speed)
        expect(
          Math.hypot(
            shots[0].flight!.x - expected.start.x,
            shots[0].flight!.y - expected.start.y,
          ),
        ).toBeCloseTo(
          Math.min(
            expected.speed * STEP,
            Math.hypot(
              expected.end.x - expected.start.x,
              expected.end.y - expected.start.y,
            ),
          ),
          12,
        );
      while (victim.hp === 1e6 && b.tick < 120) b.step();
      expect(b.tick).toBe(hit);
      expect(victim.hp).toBe(1e6 - actor.damage);
      expect(
        b.audioEvents.filter(
          (e) => e.phase === "launch" && e.actor === actor.id,
        ),
      ).toHaveLength(1);
    });

it("keeps rules-42 release-frame motion and impact timing", () => {
  const { b, actor, victim } = scene("musketeer", "blue", 42);
  const hit = attackHitSteps(actor, victim);
  b.step();
  expect(actor.nativeProjectileStep).toBeUndefined();
  expect(b.projectiles[0].elapsed).toBe(STEP);
  actor.active = false;
  while (victim.hp === 1e6 && b.tick < 120) b.step();
  expect(b.tick).toBe(hit);
  const fresh = scene("musketeer", "blue");
  expect(attackHitSteps(fresh.actor, fresh.victim)).toBe(hit + 1);
});

it("advances a spell already present at the start of combat", () => {
  const b = match();
  b.players.blue.hand[0] = "fireball";
  b.players.blue.elixir = 10;
  expect(b.play("blue", 0, 5, 10).ok).toBe(true);
  const shot = b.projectiles[0];
  expect(shot.elapsed).toBe(0);
  b.step();
  expect(shot.elapsed).toBe(STEP);
});

it("defers a combat death bomb while preserving a pre-combat death bomb's first update", () => {
  for (const duringCombat of [false, true]) {
    const { b, actor, victim } = scene("knight", "blue");
    // Lumberjack's death creates a timed projectile without a direct shot.
    victim.card = "lumberjack";
    victim.hp = 1;
    if (!duringCombat) (b as any).hurt(victim, 1);
    b.step();
    const bottle = b.projectiles.find((p) => p.style === "rage-bottle")!;
    expect(bottle).toBeDefined();
    expect(bottle.elapsed).toBe(duringCombat ? 0 : STEP);
    actor.active = false;
    b.step();
    expect(bottle.elapsed).toBe(duringCombat ? STEP : STEP * 2);
  }
});

for (const card of ["musketeer", "bowler", "executioner", "knight"] as const)
  it(`forecasts actual ${card} King damage with the authoritative first-update policy`, () => {
    const { b, actor, victim } = scene(card, "red", 43, true);
    const packets = pendingKingPackets(
      actor,
      victim,
      { position: actor, releaseStep: 1 },
      0,
    );
    expect(packets.length).toBeGreaterThan(0);
    const fatal = fatalKingWindups(
      "blue",
      b.entities.map((e) =>
        e.id === victim.id ? { ...e, hp: actor.damage } : e,
      ),
    );
    expect(fatal[0].step).toBe(attackHitSteps(actor, victim));
    const before = structuredClone(packets);
    const hits: number[] = [];
    let hp = victim.hp;
    for (let n = 0; n < 180; n++) {
      b.step();
      if (victim.hp < hp) hits.push(b.tick);
      hp = victim.hp;
      if (!actor.pendingAttack) actor.active = false;
      if (hits.length === packets.length) break;
    }
    expect(hits).toEqual(packets.map((p) => p.step));
    expect(packets).toEqual(before);
  });

it("retains newborn shots and forecast policy through guest rotation and older-host replacement", () => {
  const { b, actor } = scene("princess", "red");
  b.step();
  const saved = structuredClone(snapshot(b));
  const view = perspective(saved, "red");
  expect(
    view.entities.find((e) => e.id === actor.id)!.nativeProjectileStep,
  ).toBe(true);
  expect(view.projectiles).toHaveLength(5);
  for (const p of view.projectiles) {
    expect(p.flight).toEqual({ x: p.x, y: p.y });
    expect(p.elapsed).toBe(0);
  }
  const guest = match(42);
  applySnapshot(guest, saved, "red");
  expect(guest.projectiles).toEqual(view.projectiles);
  expect(
    guest.entities.find((e) => e.id === actor.id)!.nativeProjectileStep,
  ).toBe(true);
  expect(snapshot(b)).toEqual(saved);
  applySnapshot(guest, snapshot(match(42)), "red");
  expect(guest.entities.every((e) => !e.nativeProjectileStep)).toBe(true);
});

it("gives Mirror a fresh step policy and preserves it on Clone", () => {
  const b = match();
  const cast = (card: CardId) => {
    b.players.blue.elixir = 10;
    b.players.blue.hand[0] = card;
    expect(b.play("blue", 0, 4, 22).ok).toBe(true);
  };
  cast("musketeer");
  const original = b.entities.at(-1)!;
  cast("mirror");
  const mirrored = b.entities.at(-1)!;
  expect(mirrored.card).toBe("musketeer");
  expect(mirrored.id).not.toBe(original.id);
  expect(mirrored.nativeProjectileStep).toBe(true);
  cast("clone");
  b.step();
  const copies = b.entities.filter((e) => e.clone);
  expect(copies).toHaveLength(2);
  for (const copy of copies) {
    expect(copy.nativeProjectileStep).toBe(true);
    expect(copy.pendingAttack).toBeUndefined();
  }
});

for (const row of golden.cases.slice(0, 2))
  it(`records and replays a complete rules-43 game (${row.replay.seed})`, () => {
    const b = new Battle({ replay: { ...row.replay, version: 43 } as Replay });
    while (!b.winner && b.tick < 12000) b.step();
    expect(b.winner).toBeTruthy();
    const replay = new Battle({ replay: b.exportReplay() });
    while (replay.tick < b.tick) replay.step();
    expect(replay.rulesVersion).toBe(43);
    expect(digest(replay)).toBe(digest(b));
  });
