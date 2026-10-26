import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay } from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { applySnapshot, snapshot } from "../src/network/perspective";
import { SpriteLibrary } from "../src/render/sprites";
import { animationFrame, selectClip } from "../src/render/animation";
import { readFileSync } from "node:fs";
import * as T from "three";
import golden from "./fixtures/animation-clock-legacy-golden.json";

function setup(version: 18 | 19 = 19, card: CardId = "knight") {
  const initial = new Battle({ seed: 71, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (let i = 0; i < 90; i++) battle.step();
  battle.players.blue.hand[0] = card;
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
  const entity = battle.entities.find((e) => e.card === card)!;
  Object.assign(entity, { active: false, deploy: 0 });
  return { battle, entity };
}
const digest = (battle: Battle, excludeClock = false) => {
  const state = Object.fromEntries(
    golden.stateFields.map((key) => [key, (battle as any)[key]]),
  );
  if (excludeClock)
    state.entities = battle.entities.map(
      ({ animationTime: _clock, ...entity }) => entity,
    );
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
};

describe("buffed native loop clocks", () => {
  it.each([
    ["rage", 1.35],
    ["slow", 0.65],
    ["both", 1.35 * 0.65],
  ] as const)(
    "follows %s without jumping to the troop's birth phase",
    (status, rate) => {
      const { battle, entity } = setup();
      expect(entity.animationTime).toBeUndefined();
      const before = battle.time;
      if (status !== "slow") entity.rage = { remaining: 1 };
      if (status !== "rage") entity.slow = { remaining: 1 };
      battle.step();
      expect(entity.animationTime).toBeCloseTo(before + STEP * rate, 10);
      const clock = entity.animationTime!;
      for (let i = 0; i < 9; i++) battle.step();
      expect(entity.animationTime! - clock).toBeCloseTo(9 * STEP * rate, 10);
      entity.rage = undefined;
      entity.slow = undefined;
      const expired = entity.animationTime!;
      battle.step();
      expect(entity.animationTime).toBeCloseTo(expired + STEP, 10);
    },
  );

  it("keeps deployment in real time and leaves unbuffed troops and structures without metadata", () => {
    const { battle, entity } = setup();
    battle.step();
    expect(entity).not.toHaveProperty("animationTime");
    entity.deploy = 0.5;
    entity.rage = { remaining: 1 };
    entity.slow = { remaining: 1 };
    const before = battle.time;
    battle.step();
    expect(entity.animationTime).toBeCloseTo(before + STEP, 10);
    expect(entity.deploy).toBeCloseTo(0.5 - STEP, 10);
    for (const tower of battle.entities.filter((e) => e.kind === "tower")) {
      tower.slow = { remaining: 1 };
      tower.rage = { remaining: 1 };
    }
    battle.step();
    expect(
      battle.entities
        .filter((e) => e.kind === "tower")
        .every((e) => e.animationTime === undefined),
    ).toBe(true);
  });

  it("preserves origin rules 18 and retains exact clocks through guest snapshots and expiry", () => {
    const old = setup(18);
    old.entity.rage = { remaining: 1 };
    old.entity.slow = { remaining: 1 };
    old.battle.step();
    expect(old.entity.animationTime).toBeUndefined();
    const { battle, entity } = setup();
    entity.rage = { remaining: 1 };
    for (let i = 0; i < 10; i++) battle.step();
    const guest = new Battle({ ai: false });
    applySnapshot(guest, structuredClone(snapshot(battle)), "red");
    expect(guest.entities.find((e) => e.id === entity.id)).toMatchObject({
      team: "red",
      animationTime: entity.animationTime,
      rage: entity.rage,
    });
  });

  it("selects native idle and running frames from the same deterministic clock", () => {
    const data = JSON.parse(
      readFileSync("public/assets/animations/mega-minion.json", "utf8"),
    );
    const { battle, entity } = setup(19, "mega-minion");
    entity.rage = { remaining: 1 };
    for (let i = 0; i < 6; i++) battle.step();
    const library = new SpriteLibrary();
    const asset = {
      data,
      textures: [],
      materials: [],
      geometry: new Map(),
      scale: 1,
    };
    const sprite = {
      mesh: new T.Mesh(new T.BufferGeometry(), []),
      asset,
      lastFrame: -1,
      facingX: 0,
      facingY: -1,
    };
    for (const moving of [false, true]) {
      library.update(
        sprite,
        entity,
        undefined,
        moving,
        battle.time,
        new T.PerspectiveCamera(),
        { x: 0, y: -1 },
      );
      const clip = selectClip(data.clips, "blue", moving ? "run" : "idle", 1);
      expect(sprite.lastFrame).toBe(
        animationFrame(
          clip,
          entity.animationTime! + entity.id * 0.13,
          false,
          entity.interval,
        ),
      );
    }
    for (const geometry of asset.geometry.values() as Iterable<T.BufferGeometry>)
      geometry.dispose();
    sprite.mesh.geometry.dispose();
    library.destroy();
  });

  it("preserves all other recorded fields across complete pre-change rules-19 matches", () => {
    expect(golden.sourceCommit).toBe("847152c");
    expect(golden.excludedEntityFields).toEqual(["animationTime"]);
    expect(
      golden.cases.reduce((sum, row) => sum + row.coverage.both, 0),
    ).toBeGreaterThan(0);
    let clocks = 0;
    for (const row of golden.cases) {
      const battle = new Battle({ replay: row.replay as Replay });
      for (const checkpoint of row.checkpoints) {
        while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
        clocks += battle.entities.filter(
          (e) => e.animationTime !== undefined,
        ).length;
        expect(
          digest(battle, true),
          `seed ${row.replay.seed} tick ${checkpoint.tick}`,
        ).toBe(checkpoint.digest);
      }
    }
    expect(clocks).toBeGreaterThan(0);
  });

  it("replays current clocks exactly, including seeks through overlapping buffs and Clone", () => {
    const source = golden.cases[1].replay as Replay;
    const battle = new Battle({ replay: source });
    const checkpoints: { tick: number; digest: string }[] = [];
    while (!battle.winner && battle.tick < source.duration) {
      battle.step();
      if (battle.tick % 300 === 0 || battle.winner)
        checkpoints.push({ tick: battle.tick, digest: digest(battle) });
    }
    expect(battle.winner).toBeTruthy();
    const replay = battle.exportReplay();
    for (const checkpoint of checkpoints) {
      const seek = new Battle({ replay });
      while (seek.tick < checkpoint.tick && !seek.winner) seek.step();
      expect(digest(seek)).toBe(checkpoint.digest);
    }
    expect(source.actions.some((action) => action.card === "clone")).toBe(true);
  });
});
