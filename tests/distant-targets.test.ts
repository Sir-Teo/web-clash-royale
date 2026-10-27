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
import {
  distantTarget,
  distantTargetScore,
  spawnLane,
} from "../src/game/distant-targets";
import { primaryCandidateVisible } from "../src/game/primary-geometry";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { buildingLureTarget } from "../src/game/building-lure";
import { deploymentTime } from "../src/game/deployment";
import { combatTraits } from "../src/game/combat";
import { CARD_MAP } from "../src/game/cards";
import { snapshot, perspective } from "../src/network/perspective";
import historical from "./fixtures/distant-target-rules31-golden.json";

const read = (name: string) =>
  JSON.parse(
    readFileSync(`reference/client/${name}-native-trace.json`, "utf8"),
  );
const lanes = read("lane-assignment"),
  spawned = read("spawn-lane"),
  native = read("distant-target");
function make(version: Replay["version"] = 32) {
  const original = new Battle({ seed: 3201, ai: false });
  return new Battle({ replay: { ...original.exportReplay(), version } });
}
function unit(
  b: Battle,
  card: CardId,
  team: Team,
  x: number,
  y: number,
  hint?: number,
) {
  (b as any).spawn(card, team, x, y, true, 0, 0, hint);
  return b.entities.at(-1)!;
}
it("pins source flags, lane evidence and every imported input/output hash", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/distant-target-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(Object.values(native.sourceFlags)).toEqual([true, true]);
  expect(spawned.directCallerCount).toBe(13);
});
for (const section of ["Map", "MapTeamVsTeam"])
  for (const origin of [0, 1.3, -9.125])
    it(`matches every ordinary/hinted native lane and direct spawn store in ${section}, origin ${origin}`, () => {
      const converted = (x: number) => x / 1000 + origin - origin;
      for (const row of [...lanes.cases, ...lanes.hintedCases].filter(
        (row: any) => row.section === section,
      ))
        expect(
          spawnLane(
            converted(row.x),
            row.hint === -1 ? undefined : converted(row.hint),
          ),
          JSON.stringify(row),
        ).toBe(row.storedLane);
      for (const row of spawned.cases.filter(
        (row: any) => row.mapSection === section,
      ))
        expect(
          spawnLane(
            converted(row.prepared.x),
            row.prepared.hint === -1 ? undefined : converted(row.prepared.hint),
          ),
          JSON.stringify(row),
        ).toBe(row.storedLane);
    });
const supported = [...native.cases, ...native.controls].filter(
  (row: any) =>
    row.useLaneId &&
    row.alwaysPrincess &&
    row.accountSlots === 2 &&
    row.collection.length <= 2 &&
    row.worldScalar8C === 64,
);
for (const owner of [...new Set(supported.map((row: any) => row.owner))])
  it(`matches native regular-arena ${owner} destinations, scores, collection order and boundaries`, () => {
    const template = make().entities[0];
    for (const row of supported.filter((sample: any) => sample.owner === owner))
      for (const origin of [0, 1.3, -9.125]) {
        // Translate and undo a browser origin without changing canonical map Y.
        const point = (x: number, y: number) => ({
          x: x / 1000 + origin - origin,
          y: y / 1000 + origin - origin,
        });
        const bodies: Entity[] = [
          row.candidates.find((body: any) => body.id === row.initialDefault),
          ...row.collection.map((id: string) =>
            row.candidates.find((body: any) => body.id === id),
          ),
        ].map((body: any) => ({
          ...template,
          ...point(body.x, body.y),
          id: row.candidates.indexOf(body) + 100,
          team: "red",
          hp: 1,
          king: body.name === "KingTower",
          nativeLane: body.lane,
        }));
        const actor = {
          ...point(row.ownerPoint.x, row.ownerPoint.y),
          nativeLane: row.ownerLane,
          team: "blue" as const,
        };
        expect(distantTarget(actor, bodies)?.id, row.layout).toBe(
          row.candidates.findIndex((body: any) => body.id === row.result) + 100,
        );
        for (const scored of row.scores) {
          const body = bodies.find(
            (body) => row.candidates[body.id - 100].id === scored.target,
          )!;
          expect(distantTargetScore(actor, body), row.layout).toBeCloseTo(
            scored.adjustedScore,
            3,
          );
        }
      }
  });
it("keeps new lane fields absent from historical bodies through rules 31", () => {
  for (let version = 1; version <= 31; version++) {
    const b = make(version as Replay["version"]);
    unit(b, "knight", "blue", 9, 22);
    for (const body of b.entities)
      for (const key of [
        "nativeLane",
        "nativeDistantTargets",
        "nativeDistantMirrored",
      ])
        expect(Object.hasOwn(body, key), `${version}:${key}`).toBe(false);
  }
});
for (const team of ["blue", "red"] as const) {
  const enemy: Team = team === "blue" ? "red" : "blue";
  const forward = team === "blue" ? -1 : 1;
  for (const version of [31, 32] as const) {
    it(`uses the King after loss of the same-lane Princess only in new rules (${version}, ${team})`, () => {
      const b = make(version);
      for (const tower of b.entities) tower.active = false;
      const left = b.entities.find(
        (body) => body.team === enemy && body.lane === "left",
      )!;
      left.hp = 0;
      const actor = unit(b, "hog-rider", team, 3.5, 16 - forward * 3);
      const cannon = unit(b, "cannon", enemy, 3.5, actor.y + forward * 11.5);
      cannon.active = false;
      expect(primaryCandidateVisible(actor, cannon)).toBe(false);
      b.step();
      const king = b.entities.find((body) => body.team === enemy && body.king)!;
      expect(actor.target).toBe(version === 32 ? king.id : cannon.id);
      cannon.y = actor.y + forward * 4;
      b.step();
      expect(actor.target).toBe(cannon.id);
    });
    it(`keeps a clipped nearby structure out of new distant destinations (${version}, ${team})`, () => {
      const b = make(version);
      for (const tower of b.entities) tower.active = false;
      const actor = unit(b, "hog-rider", team, 2, 16 - forward * 4);
      const cannon = unit(b, "cannon", enemy, 9, actor.y + forward * 6);
      cannon.active = false;
      expect(primaryCandidateVisible(actor, cannon)).toBe(false);
      b.step();
      const princess = b.entities.find(
        (body) => body.team === enemy && body.lane === "left",
      )!;
      expect(actor.target).toBe(version === 32 ? princess.id : cannon.id);
    });
  }
  it(`forecasts the actual lane-aware Hog movement toward the King (${team})`, () => {
    const b = make();
    for (const tower of b.entities) tower.active = false;
    b.entities.find((body) => body.team === enemy && body.lane === "left")!.hp =
      0;
    const hog = unit(b, "hog-rider", team, 3.5, 16 - forward * 3);
    const before = structuredClone(b.entities),
      rng = (b as any).randomState;
    const predicted = meleeInterceptTarget(
      "mini-pekka",
      enemy,
      hog,
      b.entities,
      () => true,
    )!;
    const mirrored = perspective(snapshot(b), "red");
    const rotated = meleeInterceptTarget(
      "mini-pekka",
      team,
      mirrored.entities.find((body) => body.id === hog.id)!,
      mirrored.entities,
      () => true,
    )!;
    expect(rotated.x).toBeCloseTo(18 - predicted.x, 10);
    expect(rotated.y).toBeCloseTo(32 - predicted.y, 10);
    expect(b.entities).toEqual(before);
    expect((b as any).randomState).toBe(rng);
    const horizon =
      deploymentTime("mini-pekka") +
      Math.min(
        CARD_MAP["mini-pekka"].interval,
        combatTraits({ card: "mini-pekka" }).windup,
      );
    for (let tick = 0; tick < Math.round(horizon / STEP); tick++) b.step();
    expect(hog.x).toBeCloseTo(predicted.x, 9);
    expect(hog.y).toBeCloseTo(predicted.y, 9);
  });
}
it("stores spawn lanes through movement and refreshes formation, Mirror, Barrel and Clone lanes", () => {
  const b = make();
  for (const tower of b.entities) tower.active = false;
  const cast = (card: CardId, x: number, y: number) => {
    b.players.blue.elixir = 10;
    b.players.blue.hand[0] = card;
    const previous = new Set(b.entities.map((body) => body.id));
    expect(b.play("blue", 0, x, y).ok).toBe(true);
    return b.entities.filter((body) => !previous.has(body.id));
  };
  for (const card of ["skeletons", "mirror"] as const) {
    const bodies = cast(card, 8.999, 24);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies)
      expect(body.nativeLane).toBe(spawnLane(body.x, 8.999));
  }
  const actor = unit(b, "knight", "blue", 8.999, 26, 0);
  const lane = actor.nativeLane;
  actor.x = 4;
  b.step();
  expect(actor.nativeLane).toBe(lane);
  actor.active = false;
  cast("clone", actor.x, actor.y);
  for (
    let tick = 0;
    tick < 60 && !b.entities.some((body) => body.clone);
    tick++
  )
    b.step();
  const copy = b.entities.find((body) => body.clone && body.card === "knight")!;
  expect(copy).toBeTruthy();
  expect(copy.nativeLane).toBe(spawnLane(copy.x));
  expect(copy.nativeLane).not.toBe(actor.nativeLane);
  cast("goblin-barrel", 8.999, 8);
  for (
    let tick = 0;
    tick < 240 && b.projectiles.some((shot) => shot.style === "goblin-barrel");
    tick++
  )
    b.step();
  const goblins = b.entities.filter((body) => body.card === "goblins");
  expect(goblins).toHaveLength(3);
  for (const body of goblins)
    expect(body.nativeLane).toBe(spawnLane(body.x, 8.999));
});
it("preserves exact source boundary scores, stored lanes and destinations in guest projections", () => {
  for (const team of ["blue", "red"] as const)
    for (const y of [1.499, 1.5, 1.501, 30.499, 30.5, 30.501]) {
      const b = make();
      const actor = unit(b, "hog-rider", team, 8.999, y, 0);
      const before = structuredClone(b.entities);
      const view = perspective(snapshot(b), "red"),
        rotated = view.entities.find((body) => body.id === actor.id)!;
      expect(rotated.nativeLane).toBe(3 - actor.nativeLane!);
      for (const target of b.entities.filter((body) => body.kind === "tower")) {
        const projected = view.entities.find((body) => body.id === target.id)!;
        expect(distantTargetScore(rotated, projected)).toBeCloseTo(
          distantTargetScore(actor, target),
          3,
        );
      }
      expect(distantTarget(rotated, view.entities)?.id).toBe(
        distantTarget(actor, b.entities)?.id,
      );
      const twice = perspective(view, "red").entities;
      for (const body of twice) {
        const original = b.entities.find((entry) => entry.id === body.id)!;
        expect(body.x).toBeCloseTo(original.x, 12);
        expect(body.y).toBeCloseTo(original.y, 12);
        expect(body.nativeLane).toBe(original.nativeLane);
        expect(Object.hasOwn(body, "nativeDistantMirrored")).toBe(false);
      }
      expect(b.entities).toEqual(before);
    }
});
it("preserves the visible Cannon lure after lane-aware destination selection", () => {
  const b = make();
  for (const tower of b.entities) tower.active = false;
  const balloon = unit(b, "balloon", "blue", 14, 13);
  const before = structuredClone(b.entities);
  expect(
    buildingLureTarget("cannon", "red", balloon, b.entities, () => true),
  ).toEqual({ x: 9, y: 10 });
  expect(b.entities).toEqual(before);
});
it("applies common eligibility after a contrived dead-King seed in combat and AI", () => {
  const b = make(),
    actor = unit(b, "hog-rider", "blue", 3.5, 20);
  for (const body of b.entities.filter((body) => body.team === "red"))
    body.hp = 0;
  expect(distantTarget(actor, b.entities)?.king).toBe(true);
  expect((b as any).acquireTarget(actor)).toBeUndefined();
  expect(actor.target).toBeNull();
  expect(
    meleeInterceptTarget("mini-pekka", "red", actor, b.entities, () => true),
  ).toBeUndefined();
});
const digest = (match: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          historical.stateFields.map((key) => [key, (match as any)[key]]),
        ),
      ),
    )
    .digest("hex");
it("preserves complete rules-31 games including native Crowns, Barrel spawns, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("7caf6b5");
  for (const row of historical.cases) {
    const match = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (match as any).ai = true;
      (match as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (match.tick < checkpoint.tick && !match.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (action) => action.team === "blue" && action.tick === match.tick,
          ))
            expect(
              match.play(
                "blue",
                match.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
        match.step();
      }
      expect(digest(match), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
    expect(match.winner).toBeTruthy();
  }
});
it("records and replays a complete current game with actual stored lanes", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 32, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let storedLane = false;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    storedLane ||= live.entities.some(
      (body) => body.kind === "troop" && !!body.nativeLane,
    );
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(storedLane).toBe(true);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(32);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
