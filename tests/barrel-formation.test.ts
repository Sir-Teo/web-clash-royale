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
import { barrelFormation } from "../src/game/barrel-formation";
import {
  perspective,
  snapshot,
  applySnapshot,
} from "../src/network/perspective";
import historical from "./fixtures/barrel-formation-rules32-golden.json";
const native = JSON.parse(
  readFileSync(
    "reference/client/projectile-formation-native-trace.json",
    "utf8",
  ),
);
function make(version: Replay["version"] = 33) {
  const initial = new Battle({ seed: 3301, ai: false });
  const b = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const tower of b.entities) tower.active = false;
  return b;
}
function cast(b: Battle, card: CardId, team: Team, x: number, y: number) {
  b.players[team].elixir = 10;
  b.players[team].hand[0] = card;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
function land(b: Battle): Entity[] {
  const ids = new Set(b.entities.map((body) => body.id));
  const rng = (b as any).randomState;
  for (
    let tick = 0;
    tick < 240 && b.projectiles.some((shot) => shot.style === "goblin-barrel");
    tick++
  )
    b.step();
  expect((b as any).randomState).toBe(rng);
  const children = b.entities.filter(
    (body) => !ids.has(body.id) && body.card === "goblins",
  );
  expect(children).toHaveLength(3);
  return children;
}
it("pins Barrel factory evidence and every imported source/output hash", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/barrel-formation-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(native.sourceProfile).toMatchObject({
    count: 3,
    radius: 500,
    angleShift: 0,
  });
});
for (const map of ["Map", "MapTeamVsTeam"])
  for (const origin of [0, 1.3, -9.125])
    it(`matches native Barrel requests on ${map}, translated origin ${origin}`, () => {
      for (const row of native.cases.filter(
        (row: any) => row.section === map,
      )) {
        const team: Team = row.ownerIndex === 0 ? "red" : "blue";
        const center = {
          x: row.center.x / 1000 + origin - origin,
          y: row.center.y / 1000 + origin - origin,
        };
        const points = barrelFormation(center, team);
        for (const [index, point] of points.entries()) {
          expect(
            point.x,
            `${row.ownerIndex}:${row.center.x}:${index}`,
          ).toBeCloseTo(row.children[index].x / 1000, 12);
          expect(point.y).toBeCloseTo(row.children[index].y / 1000, 12);
        }
      }
    });
for (const team of ["blue", "red"] as const) {
  for (const sourceX of [3500, 8999, 9000, 14500])
    it(`creates actual source-ordered Barrel children at ${sourceX}, ${team}`, () => {
      const b = make();
      const row = native.cases.find(
        (row: any) =>
          row.section === "Map" &&
          row.ownerIndex === (team === "red" ? 0 : 1) &&
          row.center.x === sourceX &&
          row.center.y === 16000,
      );
      cast(b, "goblin-barrel", team, sourceX / 1000, 16);
      const children = land(b);
      for (const [index, body] of children.entries()) {
        expect(body.x).toBeCloseTo(row.children[index].x / 1000, 12);
        expect(body.y).toBeCloseTo(row.children[index].y / 1000, 12);
        expect(body.targetScoreBias).toBe(row.children[index].fieldAC);
        expect(body.nativeLane).toBe(row.children[index].storedLane);
        expect(body.deploy).toBe(1.2);
        expect(body.hp).toBe(body.maxHp);
      }
      const before = structuredClone(b.entities);
      const guest = make(32);
      applySnapshot(guest, snapshot(b), "red");
      for (const body of children) {
        const rotated = guest.entities.find((entry) => entry.id === body.id)!;
        expect(rotated.x).toBeCloseTo(18 - body.x, 12);
        expect(rotated.y).toBeCloseTo(32 - body.y, 12);
        expect(rotated.targetScoreBias).toBe(body.targetScoreBias);
        expect(rotated.nativeLane).toBe(3 - body.nativeLane!);
      }
      expect(b.entities).toEqual(before);
      expect(perspective(snapshot(b), "blue").entities).toBe(b.entities);
    });
  it(`starts Mirror's Barrel ordinal and formation afresh (${team})`, () => {
    const b = make();
    cast(b, "goblin-barrel", team, 3.5, 16);
    const first = land(b);
    for (const body of first) body.active = false;
    cast(b, "mirror", team, 14.5, 16);
    const second = land(b);
    const row = native.cases.find(
      (row: any) =>
        row.section === "Map" &&
        row.ownerIndex === (team === "red" ? 0 : 1) &&
        row.center.x === 14500 &&
        row.center.y === 16000,
    );
    for (const [index, body] of second.entries()) {
      expect(body.id).toBeGreaterThan(first.at(-1)!.id);
      expect(body.x).toBeCloseTo(row.children[index].x / 1000, 12);
      expect(body.y).toBeCloseTo(row.children[index].y / 1000, 12);
      expect(body.targetScoreBias).toBe(row.children[index].fieldAC);
      expect(body.nativeLane).toBe(row.children[index].storedLane);
    }
  });
  it(`retains the browser edge clamps around source formation requests (${team})`, () => {
    for (const [x, y] of [
      [0.6, 0.8],
      [17.4, 31.2],
    ]) {
      const b = make();
      cast(b, "goblin-barrel", team, x, y);
      const children = land(b);
      expect(
        children.every(
          (body) =>
            body.x >= 0.6 && body.x <= 17.4 && body.y >= 0.8 && body.y <= 31.2,
        ),
      ).toBe(true);
      expect(children.some((body) => body.x === x)).toBe(true);
      expect(children.some((body) => body.y === y)).toBe(true);
    }
  });
}
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
it("preserves complete rules-32 games, Barrel landings, lane policy and historical AI", () => {
  expect(historical.sourceCommit).toBe("1a0ae61");
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
it("records and replays a complete current game with actual Barrel children", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 33, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let barrelChildren = false;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    barrelChildren ||= live.entities.some(
      (body) => body.card === "goblins" && (body.targetScoreBias ?? 0) > 0,
    );
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(barrelChildren).toBe(true);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(33);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
