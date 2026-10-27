import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Replay,
  type Team,
} from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { advanceMovement } from "../src/game/movement";
import { chargeRange, isCharging } from "../src/game/charge";
import { NativeMovementEffects } from "../src/render/movement-effects";
import { perspective, snapshot } from "../src/network/perspective";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { combatTraits } from "../src/game/combat";
import { deploymentTime } from "../src/game/deployment";
import golden from "./fixtures/charge-legacy-golden.json";

const chargers = ["prince", "dark-prince", "battle-ram"] as const;
const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        tick: battle.tick,
        entities: battle.entities,
        projectiles: battle.projectiles,
        areas: battle.areas,
        events: battle.events,
        audio: battle.audioEvents,
        players: battle.players,
        winner: battle.winner,
        reason: battle.reason,
        actions: battle.actions,
        randomState: (battle as any).randomState,
      }),
    )
    .digest("hex");
function setup(card: CardId, team: Team = "blue", version?: Replay["version"]) {
  const initial = new Battle({ seed: 125, ai: false });
  const battle =
    version === undefined
      ? initial
      : new Battle({
          replay: { ...initial.exportReplay(), version, duration: 9000 },
        });
  for (const e of battle.entities) e.active = false;
  (battle as any).spawn(card, team, 4, team === "blue" ? 23 : 9);
  const actor = battle.entities.at(-1)!;
  actor.deploy = 0;
  actor.cooldown = 0;
  return { battle, actor };
}

it("pins native distance charge fields and the retained static dataflow", async () => {
  const { csvRows } = await import("../scripts/lib/csv.mjs");
  const rows = csvRows(readFileSync("reference/logic/characters.csv", "utf8"));
  for (const [card, name] of [
    ["prince", "Prince"],
    ["dark-prince", "DarkPrince"],
    ["battle-ram", "BattleRam"],
  ] as const) {
    const row = rows.find((r: any) => r.Name === name)!;
    expect(chargeRange(card)).toBe(Number(row.ChargeRange) / 100);
    expect(Number(row.ChargeSpeedMultiplier)).toBe(200);
  }
  const trace = JSON.parse(
    readFileSync("reference/client/charge-native-trace.json", "utf8"),
  );
  expect(trace.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
  expect(
    trace.blocks
      .find((b: any) => b.name === "chargeProgress")
      .instructions.join("\n"),
  ).toContain("add    DWORD PTR [esi+0x1cc],eax");
});

describe.each(chargers)("distance charge: %s", (card) => {
  it.each(["blue", "red"] as const)(
    "charges after the same own distance for %s with Rage and slow",
    (team) => {
      for (const [rage, slow, factor] of [
        [false, false, 1],
        [true, false, 1.35],
        [false, true, 0.65],
        [true, true, 1.35 * 0.65],
      ] as const) {
        const { battle, actor } = setup(card, team);
        actor.rage = rage ? { remaining: 100 } : undefined;
        actor.slow = slow ? { remaining: 100 } : undefined;
        const start = { x: actor.x, y: actor.y };
        let ticks = 0;
        while (!isCharging(actor) && ticks < 300) {
          expect(actor.chargeDistance).toBeCloseTo(
            Math.hypot(actor.x - start.x, actor.y - start.y),
          );
          battle.step();
          ticks++;
        }
        expect(isCharging(actor)).toBe(true);
        expect(actor.chargeDistance).toBeGreaterThanOrEqual(chargeRange(card));
        expect(ticks * STEP).toBeGreaterThanOrEqual(
          chargeRange(card) / actor.speed / factor - 1e-8,
        );
        expect(ticks * STEP).toBeLessThan(
          chargeRange(card) / actor.speed / factor + STEP + 1e-8,
        );
        const y = actor.y;
        battle.step();
        expect(Math.abs(actor.y - y)).toBeCloseTo(
          actor.speed * factor * 2 * STEP,
        );
        const guest = perspective(snapshot(battle), "red").entities.find(
          (e) => e.id === actor.id,
        )!;
        expect(guest.chargeDistance).toBe(actor.chargeDistance);
        expect(isCharging(guest)).toBe(true);
      }
    },
  );

  it("resets distance when attacking and when Zap interrupts the charged windup", () => {
    const { battle, actor } = setup(card);
    const target = battle.entities.find((e) => e.team === "red" && !e.king)!;
    Object.assign(target, { x: 4, y: 22, hp: 10000, maxHp: 10000 });
    actor.chargeDistance = chargeRange(card);
    battle.step();
    expect(actor.pendingAttack?.damage).toBe(
      card === "prince" ? actor.damage * 2 : card === "dark-prince" ? 467 : 610,
    );
    expect(actor.chargeDistance).toBe(0);
    actor.chargeDistance = chargeRange(card);
    battle.players.red.hand[0] = "zap";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, actor.x, actor.y).ok).toBe(true);
    for (let i = 0; i < 6; i++) battle.step();
    expect(actor.stun).toBeGreaterThan(0);
    expect(actor.pendingAttack).toBeUndefined();
    expect(actor.chargeDistance).toBe(0);
    expect(target.hp).toBe(10000);
  });
});

it("does not gain charge from Tornado, collision separation, arena clamps or deployment", () => {
  const { battle, actor } = setup("prince");
  actor.active = false;
  battle.players.red.hand[0] = "tornado";
  battle.players.red.elixir = 10;
  expect(battle.play("red", 0, 7, 23).ok).toBe(true);
  const x = actor.x;
  for (let i = 0; i < 15; i++) battle.step();
  expect(actor.x).toBeGreaterThan(x);
  expect(actor.chargeDistance).toBe(0);
  (battle as any).spawn("knight", "blue", actor.x + 0.1, actor.y);
  const other = battle.entities.at(-1)!;
  other.deploy = 0;
  const before = { x: actor.x, y: actor.y };
  (battle as any).separate();
  expect(Math.hypot(actor.x - before.x, actor.y - before.y)).toBeGreaterThan(0);
  expect(actor.chargeDistance).toBe(0);
  Object.assign(actor, { x: 0.5, y: 2, speed: 1 });
  advanceMovement(actor, { x: -10, y: 2 });
  expect(actor.chargeDistance).toBe(0);
  battle.areas = [];
  Object.assign(actor, { x: 4, y: 23, active: true, deploy: 0.5 });
  battle.step();
  expect(actor.chargeDistance).toBe(0);
});

it("starts a cloned charger with zero charge distance", () => {
  const { battle, actor } = setup("dark-prince");
  actor.active = false;
  actor.chargeDistance = 2.5;
  battle.players.blue.hand[0] = "clone";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, actor.x, actor.y).ok).toBe(true);
  for (let i = 0; i < 3; i++) battle.step();
  const clone = battle.entities.find((e) => e.clone)!;
  expect(clone).toBeDefined();
  expect(clone.chargeDistance).toBe(0);
  expect(isCharging(clone)).toBe(false);
});

it("emits the charge cue at the distance crossing once, independent of the movement timer", () => {
  const { actor } = setup("prince");
  const effects = new NativeMovementEffects();
  Object.assign(actor, { move: 1, chargeDistance: 2.4 });
  effects.consume([actor], 4, 1);
  for (let i = 0; i < 15; i++) advanceMovement(actor, { x: 4, y: 2 });
  expect(actor.chargeDistance).toBeCloseTo(3.3);
  const charges = effects
    .consume([actor], 4, 1.5)
    .filter((b) => b.effect === "charge:prince");
  expect(charges).toHaveLength(1);
  expect(charges[0].origin.y).toBeCloseTo(22.9);
  expect(charges[0].age).toBeCloseTo(4 / 9);
  expect(effects.consume([actor], 4, 1.5)).toEqual([]);
  advanceMovement(actor, { x: 4, y: 2 });
  expect(
    effects
      .consume([actor], 4, 1.5 + STEP)
      .filter((b) => b.effect === "charge:prince"),
  ).toEqual([]);
});

it("leads a Battle Ram through a distance charge and modifier expiry without mutating it", () => {
  const { battle, actor } = setup("battle-ram");
  Object.assign(actor, {
    y: 12,
    chargeDistance: 2.7,
    rage: { remaining: 0.3 },
    slow: { remaining: 0.7 },
  });
  const before = structuredClone(actor);
  const point = meleeInterceptTarget(
    "mini-pekka",
    "red",
    actor,
    battle.entities,
    () => true,
  )!;
  const horizon =
    deploymentTime("mini-pekka") +
    Math.min(
      CARD_MAP["mini-pekka"].interval,
      combatTraits({ card: "mini-pekka" }).windup,
    );
  const mover = structuredClone(actor);
  const target = battle.entities.find(
    (e) => e.team === "red" && e.lane === "left",
  )!;
  for (let t = 0; t < horizon - 1e-8; t += STEP) {
    advanceMovement(mover, target);
    if (mover.rage && (mover.rage.remaining -= STEP) <= 1e-8)
      mover.rage = undefined;
    if (mover.slow && (mover.slow.remaining -= STEP) <= 1e-8)
      mover.slow = undefined;
  }
  // Continuous planning may cross the charge boundary within a simulation step.
  expect(point.x).toBeLessThan(actor.x);
  expect(Math.hypot(point.x - mover.x, point.y - mover.y)).toBeLessThan(
    actor.speed * 2 * 1.35 * STEP,
  );
  expect(actor).toEqual(before);
});

it("reproduces every captured state, action and RNG checkpoint for origin versions 1–16", () => {
  expect(golden.sourceCommit).toBe("8048bae");
  expect(golden.cases).toHaveLength(16);
  for (const row of golden.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
      expect(
        digest(battle),
        `version ${row.replay.version}, tick ${checkpoint.tick}`,
      ).toBe(checkpoint.digest);
    }
  }
}, 30000);

it("records and reconstructs a complete current match with all three chargers", () => {
  const source = golden.cases.at(-1)!.replay;
  const live = new Battle({
    ai: false,
    seed: source.seed,
    deck: source.deck as CardId[],
    enemyDeck: source.enemyDeck as CardId[],
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  const seen = new Set<string>();
  while (!live.winner && live.tick < 9000) {
    for (const action of source.actions.filter((a) => a.tick === live.tick)) {
      const team = action.team as Team;
      const slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    for (const e of live.entities) if (isCharging(e)) seen.add(e.card);
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect([...seen]).toEqual(expect.arrayContaining([...chargers]));
  const record = live.exportReplay();
  expect(record.version).toBe(35);
  const replay = new Battle({ replay: record });
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay), `current tick ${checkpoint.tick}`).toBe(
      checkpoint.digest,
    );
  }
});
