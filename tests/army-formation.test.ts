import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { armyFormation } from "../src/game/army-formation";
import { deploymentPositions } from "../src/game/deployment";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import native from "./fixtures/native-formation-golden.json";
import historical from "./fixtures/army-formation-rules33-golden.json";
function make(version: Replay["version"] = 34) {
  const original = new Battle({ seed: 3401, ai: false });
  const b = new Battle({ replay: { ...original.exportReplay(), version } });
  for (const tower of b.entities) tower.active = false;
  return b;
}
function cast(b: Battle, team: Team, x: number, y: number) {
  b.players[team].elixir = 10;
  b.players[team].hand[0] = "skeleton-army";
  const ids = new Set(b.entities.map((body) => body.id));
  expect(b.play(team, 0, x, y).ok).toBe(true);
  return b.entities.filter((body) => !ids.has(body.id));
}
const source = (team: Team) =>
  native.cases.find(
    (row) =>
      row.count === 15 &&
      row.radius === 500 &&
      row.angleShift === 0 &&
      row.flipY === (team === "red") &&
      row.lane === 0,
  )!;
it("pins source rows, fifteen-body CPU evidence and every imported hash", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/army-formation-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(native.cases.filter((row) => row.count === 15)).toHaveLength(4);
});
for (const team of ["blue", "red"] as const)
  for (const x of [3.5, 9, 14.5])
    it(`matches source requests and actual fifteen-body deployment at ${x}, ${team}`, () => {
      const b = make(),
        center = { x, y: team === "blue" ? 22 : 10 };
      const rng = (b as any).randomState;
      const expected = source(team).points.map(([dx, dy]) => ({
        x: center.x + dx / 1000,
        y: center.y + dy / 1000,
      }));
      expect(armyFormation(center, team)).toEqual(expected);
      expect(
        deploymentPositions("skeleton-army", center, team, undefined, 34),
      ).toEqual(expected);
      const bodies = cast(b, team, center.x, center.y);
      expect(bodies).toHaveLength(15);
      expect(bodies.map(({ x, y }) => ({ x, y }))).toEqual(expected);
      expect(
        bodies.every((body) => body.deploy === 1 && body.hp === body.maxHp),
      ).toBe(true);
      expect((b as any).randomState).toBe(rng);
      expect(b.nativeArmyFormation).toBe(true);
      expect(snapshot(b).nativeArmyFormation).toBe(true);
    });
it("preserves historical formation metadata and preview policy through rules 33", () => {
  for (let version = 1; version <= 33; version++) {
    const b = make(version as Replay["version"]);
    expect(b.nativeArmyFormation).toBeUndefined();
    expect(Object.hasOwn(snapshot(b), "nativeArmyFormation")).toBe(false);
    expect(Object.hasOwn(snapshot(b), "nativeArmyViewMirrored")).toBe(false);
  }
  const b = make(33),
    center = { x: 9, y: 22 };
  const bodies = cast(b, "blue", center.x, center.y);
  expect(bodies.map(({ x, y }) => ({ x, y }))).toEqual(
    deploymentPositions("skeleton-army", center, "blue", undefined, 33),
  );
  expect(bodies.map(({ x, y }) => ({ x, y }))).not.toEqual(
    armyFormation(center, "blue"),
  );
});
for (const hostVersion of [33, 34] as const)
  for (const view of ["blue", "red"] as const)
    it(`uses the rules-${hostVersion} host's formation and guest preview policy on ${view}`, () => {
      const host = make(hostVersion),
        guest = make(hostVersion === 34 ? 33 : 34);
      const team: Team = view === "red" ? "red" : "blue";
      const center = {
        x: view === "red" ? 17.4 : 0.6,
        y: view === "red" ? 1.1 : 30.9,
      };
      const bodies = cast(host, team, center.x, center.y);
      const original = structuredClone(host.entities);
      const state = snapshot(host);
      applySnapshot(guest, state, view);
      expect(guest.nativeArmyFormation).toBe(
        hostVersion === 34 ? true : undefined,
      );
      expect(guest.nativeArmyViewMirrored).toBe(
        hostVersion === 34 && view === "red" ? true : undefined,
      );
      const point =
        view === "red" ? { x: 18 - center.x, y: 32 - center.y } : center;
      const preview = deploymentPositions(
        "skeleton-army",
        point,
        "blue",
        undefined,
        guest.nativeArmyFormation ? 34 : 33,
        guest.nativeArmyViewMirrored,
      );
      for (const [index, body] of bodies.entries()) {
        const shown = guest.entities.find((entry) => entry.id === body.id)!;
        // Historical previews retain their existing own-view interpretation.
        if (hostVersion === 34 || view === "blue") {
          expect(preview[index].x).toBeCloseTo(shown.x, 11);
          expect(preview[index].y).toBeCloseTo(shown.y, 11);
        }
      }
      const twice = perspective(perspective(state, "red"), "red");
      expect(Object.hasOwn(twice, "nativeArmyViewMirrored")).toBe(false);
      expect(host.entities).toEqual(original);
      host.entities = [];
      applySnapshot(guest, snapshot(host), view);
      expect(guest.nativeArmyFormation).toBe(
        hostVersion === 34 ? true : undefined,
      );
      expect(guest.nativeArmyViewMirrored).toBe(
        hostVersion === 34 && view === "red" ? true : undefined,
      );
    });
it("clears newer guest preview policy when an older host omits it", () => {
  const guest = make();
  applySnapshot(guest, snapshot(make()), "red");
  expect(guest.nativeArmyViewMirrored).toBe(true);
  applySnapshot(guest, snapshot(make(33)), "red");
  expect(guest.nativeArmyFormation).toBeUndefined();
  expect(guest.nativeArmyViewMirrored).toBeUndefined();
});
for (const version of [33, 34] as const)
  it(`keeps coincident-body separation deterministic and versioned (${version})`, () => {
    const b = make(version);
    const bodies = Array.from({ length: 3 }, () => {
      (b as any).spawn("knight", "blue", 9, 22, true, 0);
      return b.entities.at(-1)!;
    });
    for (const body of bodies) Object.assign(body, { active: false, speed: 0 });
    const beforeRng = (b as any).randomState;
    (b as any).separate();
    expect((b as any).randomState).toBe(beforeRng);
    const distinct = new Set(bodies.map((body) => `${body.x}:${body.y}`));
    expect(distinct.size).toBe(version === 34 ? 3 : 1);
    expect(
      bodies.every(
        (body) => Number.isFinite(body.x) && Number.isFinite(body.y),
      ),
    ).toBe(true);
    const second = make(version);
    const copies = bodies.map((body) => ({ ...body, x: 9, y: 22 }));
    second.entities = [...second.entities, ...copies];
    (second as any).separate();
    expect(copies.map(({ x, y }) => ({ x, y }))).toEqual(
      bodies.map(({ x, y }) => ({ x, y })),
    );
  });
it("retains native Army requests during deployment then separates the coincident centers", () => {
  const b = make(),
    bodies = cast(b, "blue", 9, 22);
  for (const body of bodies) Object.assign(body, { active: false, speed: 0 });
  const initial = bodies.map(({ x, y }) => ({ x, y }));
  expect(new Set(initial.map((point) => `${point.x}:${point.y}`)).size).toBe(
    13,
  );
  b.step();
  expect(bodies.map(({ x, y }) => ({ x, y }))).toEqual(initial);
  for (let tick = 0; tick < 40; tick++) b.step();
  expect(new Set(bodies.map((body) => `${body.x}:${body.y}`)).size).toBe(15);
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
it("preserves complete rules-33 games, source Barrel formations, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("2d15ba8");
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
it("records and replays a complete current game with actual native Army deployments", () => {
  const old = historical.cases[0].replay;
  const card = (id: string): CardId =>
    (id === "knight" ? "skeleton-army" : id) as CardId;
  const live = new Battle({
    replay: {
      ...old,
      deck: old.deck.map(card),
      enemyDeck: old.enemyDeck.map(card),
      version: 34,
      actions: [],
      duration: 12000,
    } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let armies = false;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(card(action.card));
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    armies ||= live.entities.some((body) => body.card === "skeleton-army");
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(armies).toBe(true);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(34);
  expect(replay.nativeArmyFormation).toBe(true);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
