import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { deploymentPositions } from "../src/game/deployment";
import type { CardId } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import data from "../src/game/formation-data.json";
import native from "./fixtures/native-formation-golden.json";
import historical from "./fixtures/formation-legacy-golden.json";

function scene(card: CardId, team: Team, ownX: number, version: 18 | 19 = 19) {
  const initial = new Battle({ seed: 71, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  const x = team === "blue" ? ownX : 18 - ownX;
  const y = team === "blue" ? 22 : 10;
  battle.players[team].hand[0] = card;
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, x, y).ok).toBe(true);
  return { battle, x, y };
}
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

describe("source-backed small card formations", () => {
  it.each(Object.entries(data.cards))(
    "deploys %s from native CPU offsets in both lane perspectives",
    (id, definition) => {
      for (const team of ["blue", "red"] as const)
        for (const ownX of [4, 14]) {
          const row = native.cases.find(
            (c) =>
              c.count === definition.count &&
              c.radius === definition.radius &&
              c.angleShift === definition.angleShift &&
              !c.flipY &&
              c.lane === (ownX > 9 ? 1 : 0),
          )!;
          expect(row, id).toBeDefined();
          const { battle, x, y } = scene(id as CardId, team, ownX);
          const bodies = battle.entities.filter((e) => e.kind === "troop");
          expect(bodies).toHaveLength(row.count);
          const rotation = team === "blue" ? 1 : -1;
          bodies.forEach((body, i) => {
            expect(body.x).toBeCloseTo(
              x + (rotation * row.points[i][0]) / 1000,
              10,
            );
            expect(body.y).toBeCloseTo(
              y + (rotation * row.points[i][1]) / 1000,
              10,
            );
            expect(body.deploy).toBe(1);
          });
          const guest = perspective(snapshot(battle), team).entities.filter(
            (e) => e.kind === "troop",
          );
          const preview = deploymentPositions(id as CardId, { x: ownX, y: 22 });
          guest.forEach((body, i) => {
            expect(body.x).toBeCloseTo(preview[i].x, 10);
            expect(body.y).toBeCloseTo(preview[i].y, 10);
          });
          const center = bodies.reduce(
            (p, e) => ({ x: p.x + e.x, y: p.y + e.y }),
            { x: 0, y: 0 },
          );
          expect(Math.abs(center.x / bodies.length - x)).toBeLessThan(0.001);
          expect(Math.abs(center.y / bodies.length - y)).toBeLessThan(0.001);
        }
    },
  );
  it("retains large/single layouts and keeps the existing browser edge clamps", () => {
    for (const card of ["skeleton-army", "knight"] as const)
      expect(deploymentPositions(card, { x: 4, y: 22 })).toEqual(
        deploymentPositions(card, { x: 4, y: 22 }, "blue", undefined, 18),
      );
    for (const card of Object.keys(data.cards) as CardId[])
      for (const point of [
        { x: 1, y: 18.1 },
        { x: 17, y: 31 },
      ]) {
        const before = { ...point };
        for (const p of deploymentPositions(card, point)) {
          expect(p.x).toBeGreaterThanOrEqual(0.6);
          expect(p.x).toBeLessThanOrEqual(17.4);
          expect(p.y).toBeGreaterThanOrEqual(0.8);
          expect(p.y).toBeLessThanOrEqual(31.2);
        }
        expect(point).toEqual(before);
      }
  });
});

it("reproduces every captured rules-18 formation checkpoint including visual metadata", () => {
  expect(historical.sourceCommit).toBe("f2413c5");
  expect(historical.cases).toHaveLength(3);
  const played = new Set(
    historical.cases.flatMap((r) => r.replay.actions.map((a) => a.card)),
  );
  for (const card of Object.keys(data.cards))
    expect(played.has(card), card).toBe(true);
  for (const row of historical.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
      expect(
        digest(battle),
        `seed ${row.replay.seed}, tick ${checkpoint.tick}`,
      ).toBe(checkpoint.digest);
    }
  }
});

it("records and reproduces a complete rules-19 match with the corrected layouts", () => {
  const source = historical.cases[0].replay;
  const battle = new Battle({
    replay: { ...source, version: 19, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  for (let tick = 0; tick < 12000 && !battle.winner; tick++) {
    for (const a of source.actions.filter((a) => a.tick === battle.tick)) {
      const team = a.team as Team;
      const slot = battle.players[team].hand.indexOf(a.card as CardId);
      if (slot >= 0) battle.play(team, slot, a.x, a.y);
    }
    battle.step();
    if (battle.tick % 300 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  expect(battle.winner).toBeTruthy();
  const record = battle.exportReplay();
  expect(record.version).toBe(19);
  const replay = new Battle({ replay: record });
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay), `current tick ${checkpoint.tick}`).toBe(
      checkpoint.digest,
    );
  }
});
