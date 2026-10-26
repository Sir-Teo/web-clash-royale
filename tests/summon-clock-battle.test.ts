import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { deploymentTime } from "../src/game/deployment";
import {
  summonProfile,
  summonCycle,
  type SummonerCard,
} from "../src/game/summon-clock";
import { cardDetails } from "../src/ui/card-details";
import { perspective, snapshot } from "../src/network/perspective";
import golden from "./fixtures/summon-clock-rules20-golden.json";

const cards = [
  "witch",
  "night-witch",
  "goblin-hut",
  "tombstone",
  "furnace",
  "barbarian-hut",
] as const;
const rows = (id: CardId) =>
  Object.fromEntries(
    cardDetails(id).stats.map((row) => [row.label, row.value]),
  );
function setup(
  card: SummonerCard,
  team: Team = "blue",
  version: Replay["version"] = 21,
) {
  const initial = new Battle({ seed: 37, ai: false });
  const battle = new Battle({
    replay: { ...initial.exportReplay(), version, rulesFamily: "origin" },
  });
  for (const e of battle.entities) e.active = false;
  battle.players[team].hand[0] = card;
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 9, team === "blue" ? 22 : 10).ok).toBe(true);
  const parent = battle.entities.find((e) => e.card === card)!;
  parent.speed = 0;
  const profile = summonProfile(card)!;
  const births: {
    time: number;
    count: number;
    index: number;
    timer: number;
  }[] = [];
  const step = (ticks = 1) => {
    for (let tick = 0; tick < ticks && !battle.winner; tick++) {
      const previous = Math.max(...battle.entities.map((e) => e.id));
      battle.step();
      const children = battle.entities.filter(
        (e) => e.id > previous && e.card === profile.child && e.team === team && !e.clone,
      );
      if (children.length) {
        births.push({
          time: battle.time,
          count: children.length,
          index: parent.spawnIndex!,
          timer: parent.spawnTimer,
        });
        for (const child of children)
          expect(child.deploy).toBe(
            deploymentTime(child.card as CardId, version),
          );
      }
    }
  };
  const until = (count: number, limit = 1400) => {
    for (
      let tick = 0;
      tick < limit && births.length < count && !battle.winner;
      tick++
    )
      step();
    expect(births.length).toBeGreaterThanOrEqual(count);
  };
  return { battle, parent, profile, births, step, until };
}
const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (battle as any)[key]]),
        ),
      ),
    )
    .digest("hex");

describe.each(cards)("current summoner: %s", (card) => {
  it.each(["blue", "red"] as const)(
    "starts on deployment expiry and follows its native wave (%s)",
    (team) => {
      const s = setup(card, team),
        p = s.profile;
      expect(s.parent.spawnTimer).toBe(0);
      expect(s.parent.spawnIndex).toBe(0);
      s.step(29);
      expect(s.births).toEqual([]);
      s.step();
      expect(s.births[0].time).toBeCloseTo(1, 8);
      expect(s.parent.deploy).toBe(0);
      const packets = p.interval > 0 ? p.count : 1;
      s.until(packets + 1);
      expect(s.births.map((b) => b.count)).toEqual(
        Array(packets + 1).fill(p.interval > 0 ? 1 : p.count),
      );
      for (let i = 1; i < packets; i++)
        expect(
          Math.abs(s.births[i].time - s.births[i - 1].time - p.interval),
        ).toBeLessThanOrEqual(STEP + 1e-8);
      expect(
        Math.abs(s.births[packets].time - s.births[0].time - summonCycle(p)),
      ).toBeLessThanOrEqual(STEP + 1e-8);
      expect(rows(card)["First spawn delay"]).toBe("0 s");
      if (card === "witch") {
        expect(rows(card)).toMatchObject({
          Spawns: "3 Skeletons",
          "Troop spacing": "0.3 s",
          "Wave interval": "7.5 s",
          "Spawn targets": "Ground",
        });
        expect(
          s.battle.audioEvents.filter(
            (e) => e.actor === s.parent.id && e.phase === "summon",
          ),
        ).toHaveLength(2);
      }
      const rotated = perspective(
        snapshot(s.battle),
        team === "blue" ? "red" : "blue",
      ).entities.find((e) => e.id === s.parent.id)!;
      expect(rotated.spawnIndex).toBe(s.parent.spawnIndex);
      expect(rotated.spawnTimer).toBe(s.parent.spawnTimer);
    },
  );
  it("holds its unfinished clock during real Freeze and resumes afterward", () => {
    const s = setup(card);
    s.until(1);
    const timer = s.parent.spawnTimer,
      index = s.parent.spawnIndex;
    s.battle.players.red.hand[0] = "freeze";
    s.battle.players.red.elixir = 10;
    expect(s.battle.play("red", 0, s.parent.x, s.parent.y).ok).toBe(true);
    s.step(90);
    expect(s.births).toHaveLength(1);
    expect(s.parent.spawnTimer).toBe(timer);
    expect(s.parent.spawnIndex).toBe(index);
    s.until(2);
    expect(s.births[1].time - s.births[0].time).toBeGreaterThan(4);
  });
  it("retains all earlier origin initial clocks without adding a wave index", () => {
    const previous =
      card === "witch"
        ? 4
        : card === "night-witch"
          ? 5
          : card === "goblin-hut"
            ? 4.95
            : card === "tombstone"
              ? 2.95
              : card === "furnace"
                ? 9.4
                : 13.5;
    for (let version = 1; version <= 20; version++) {
      const s = setup(card, "blue", version as Replay["version"]);
      expect(s.parent.spawnTimer).toBe(previous);
      expect(s.parent).not.toHaveProperty("spawnIndex");
    }
  });
});

it.each(["rage", "slow", "both"])(
  "scales serial Witch clocks under %s and preserves their remainder",
  (modifier) => {
    const s = setup("witch");
    if (modifier === "rage" || modifier === "both")
      s.parent.rage = { remaining: 30 };
    if (modifier === "slow" || modifier === "both")
      s.parent.slow = { remaining: 30 };
    const rate = (s.parent.rage ? 1.35 : 1) * (s.parent.slow ? 0.65 : 1);
    s.until(4);
    expect(
      Math.abs(s.births[3].time - s.births[0].time - 7.5 / rate),
    ).toBeLessThanOrEqual(STEP + 1e-8);
    expect(s.births.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  },
);

it("stops a destroyed Witch's unfinished serial wave", () => {
  const s = setup("witch");
  s.until(1);
  (s.battle as any).hurt(s.parent, s.parent.hp);
  s.step(90);
  expect(s.births).toHaveLength(1);
});

it("Mirror starts a fresh native Witch wave", () => {
  const s = setup("witch");
  s.until(2);
  s.battle.players.blue.hand[0] = "mirror";
  s.battle.players.blue.elixir = 10;
  expect(s.battle.play("blue", 0, 4, 22).ok).toBe(true);
  const mirrored = s.battle.entities.filter((e) => e.card === "witch").at(-1)!;
  expect(mirrored.id).not.toBe(s.parent.id);
  expect(mirrored.spawnTimer).toBe(0);
  expect(mirrored.spawnIndex).toBe(0);
});

it("Clone preserves the existing copied serial clock state", () => {
  const s = setup("witch");
  s.until(2);
  s.battle.players.blue.hand[0] = "clone";
  s.battle.players.blue.elixir = 10;
  expect(s.battle.play("blue", 0, s.parent.x, s.parent.y).ok).toBe(true);
  s.step();
  const clone = s.battle.entities.find((e) => e.card === "witch" && e.clone)!;
  expect(clone).toBeTruthy();
  expect(clone.spawnIndex).toBe(2);
  // Areas copy the source before Combat advances the original this step.
  expect(clone.spawnTimer - s.parent.spawnTimer).toBeCloseTo(STEP, 8);
});

it("keeps complete pre-change rules-20 summoner worlds and RNG identical", () => {
  expect(golden.sourceCommit).toBe("52d1d8d");
  for (const row of golden.cases) {
    for (const card of cards) expect(row.parents[card]).toBeGreaterThan(0);
    const battle = new Battle({ replay: row.replay as Replay });
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
      expect(
        digest(battle),
        `seed ${row.replay.seed} tick ${checkpoint.tick}`,
      ).toBe(checkpoint.digest);
    }
  }
});

it("records and replays a complete rules-21 match with every summoner", () => {
  const old = golden.cases[0].replay as Replay;
  const battle = new Battle({
    replay: { ...old, version: 21, actions: [], duration: 9000 },
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  while (!battle.winner && battle.tick < 9000) {
    for (const action of old.actions.filter((a) => a.tick === battle.tick)) {
      const slot = battle.players[action.team].hand.indexOf(action.card);
      if (slot >= 0) battle.play(action.team, slot, action.x, action.y);
    }
    battle.step();
    if (battle.tick % 600 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  expect(battle.winner).toBeTruthy();
  for (const card of cards)
    expect(battle.actions.some((a) => a.card === card)).toBe(true);
  const record = battle.exportReplay();
  expect(record.version).toBe(21);
  const replay = new Battle({ replay: record });
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay), `current tick ${checkpoint.tick}`).toBe(
      checkpoint.digest,
    );
  }
});
