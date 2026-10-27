import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { type CardId, CARD_MAP } from "../src/game/cards";
import { groupFormation } from "../src/game/group-formation";
import { deploymentPositions } from "../src/game/deployment";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import data from "../src/game/group-formation-data.json";
import historical from "./fixtures/group-formation-rules34-golden.json";
const native = JSON.parse(
  readFileSync("reference/client/group-formation-native-trace.json", "utf8"),
);
const cards = Object.keys(data.cards) as CardId[];
const teamOf = (owner: number): Team => (owner % 2 === 0 ? "red" : "blue");
function make(version: Replay["version"] = 35) {
  const original = new Battle({ seed: 3501, ai: false });
  const b = new Battle({ replay: { ...original.exportReplay(), version } });
  for (const tower of b.entities) tower.active = false;
  return b;
}
function cast(b: Battle, card: CardId, team: Team, x: number, y: number) {
  b.players[team].elixir = 10;
  b.players[team].hand[0] = card;
  const ids = new Set(b.entities.map((body) => body.id));
  expect(b.play(team, 0, x, y).ok).toBe(true);
  return b.entities.filter((body) => !ids.has(body.id));
}
it("pins native group entry, radius/lane/owner bindings and all projection hashes", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/group-formation-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(cards).toHaveLength(13);
  expect(
    groupFormation("skeleton-army", { x: 9, y: 22 }, "blue"),
  ).toBeUndefined();
});
for (const card of cards)
  it(`matches captured physical lanes, parity and source child order for ${card}`, () => {
    const profile = data.cards[card as keyof typeof data.cards];
    const rows = [...native.cases, ...native.controls].filter(
      (row: any) =>
        row.card === card &&
        row.effectiveCount === profile.count &&
        row.effectiveRadius === profile.radius,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows)
      for (const origin of [0, 1.3, -9.125]) {
        const center = {
          x: row.center.x / 1000 + origin - origin,
          y: row.center.y / 1000 + origin - origin,
        };
        const points = groupFormation(card, center, teamOf(row.ownerIndex))!;
        expect(points).toHaveLength(row.children.length);
        for (const [index, point] of points.entries()) {
          expect(
            point.x,
            `${row.ownerIndex}:${row.center.x}:${index}`,
          ).toBeCloseTo(row.children[index].x / 1000, 12);
          expect(point.y).toBeCloseTo(row.children[index].y / 1000, 12);
        }
      }
  });
for (const card of cards)
  for (const team of ["blue", "red"] as const)
    it(`deploys actual native ${card} bodies in order on both physical lanes (${team})`, () => {
      for (const x of [3.5, 14.5]) {
        const b = make(),
          y = team === "blue" ? 22 : 10;
        const row = native.cases.find(
          (row: any) =>
            row.section === "Map" &&
            row.card === card &&
            row.ownerIndex === (team === "red" ? 0 : 1) &&
            row.center.x === x * 1000,
        );
        const rng = (b as any).randomState;
        const bodies = cast(b, card, team, x, y);
        expect(bodies).toHaveLength(CARD_MAP[card].count);
        for (const [index, body] of bodies.entries()) {
          expect(body.x).toBeCloseTo(row.children[index].x / 1000, 12);
          expect(body.y).toBeCloseTo(
            y + (row.children[index].y - row.center.y) / 1000,
            12,
          );
          expect(body.nativeLane).toBe(x < 9 ? 1 : 2);
          expect(body.hp).toBe(body.maxHp);
          expect(body.deploy).toBe(1);
          const expectedCard =
            row.children[index].character === row.profile.secondary
              ? "spear-goblins"
              : card === "goblin-gang"
                ? "goblins"
                : card === "minion-horde"
                  ? "minions"
                  : card === "three-musketeers"
                    ? "musketeer"
                    : card;
          expect(body.card).toBe(expectedCard);
        }
        expect((b as any).randomState).toBe(rng);
      }
    });
for (const card of ["archers", "goblins", "bats"] as const)
  it(`keeps actual midpoint quantization and source body order for ${card}`, () => {
    for (const team of ["blue", "red"] as const) {
      const b = make(),
        y = team === "blue" ? 22 : 10;
      const row = native.controls.find(
        (row: any) =>
          row.section === "Map" &&
          row.control === "midpoint" &&
          row.card === card &&
          row.ownerIndex === (team === "red" ? 0 : 1) &&
          row.center.x === 9000,
      );
      const bodies = cast(b, card, team, 9, y);
      for (const [index, body] of bodies.entries()) {
        expect(body.x).toBeCloseTo(row.children[index].x / 1000, 12);
        expect(body.y).toBeCloseTo(
          y + (row.children[index].y - 16000) / 1000,
          12,
        );
      }
    }
  });
it("omits the new group policy from every historical snapshot through rules 34", () => {
  for (let version = 1; version <= 34; version++) {
    const b = make(version as Replay["version"]);
    expect(b.nativeGroupFormation).toBeUndefined();
    expect(Object.hasOwn(snapshot(b), "nativeGroupFormation")).toBe(false);
  }
});
for (const hostVersion of [34, 35] as const)
  for (const view of ["blue", "red"] as const)
    it(`matches a rules-${hostVersion} host's deployed groups and guest edge previews on ${view}`, () => {
      for (const card of cards)
        for (const edge of [false, true]) {
          const host = make(hostVersion),
            guest = make(hostVersion === 35 ? 34 : 35);
          const center =
            view === "red"
              ? { x: edge ? 17.4 : 9, y: edge ? 1.1 : 10 }
              : { x: edge ? 0.6 : 9, y: edge ? 30.9 : 22 };
          const bodies = cast(host, card, view, center.x, center.y);
          const before = structuredClone(host.entities),
            rng = (host as any).randomState;
          applySnapshot(guest, snapshot(host), view);
          expect(guest.nativeGroupFormation).toBe(
            hostVersion === 35 ? true : undefined,
          );
          const point =
            view === "red" ? { x: 18 - center.x, y: 32 - center.y } : center;
          const preview = deploymentPositions(
            card,
            point,
            "blue",
            undefined,
            guest.nativeGroupFormation ? 35 : Math.min(guest.rulesVersion, 34),
            guest.nativeArmyViewMirrored,
          );
          for (const [index, body] of bodies.entries()) {
            const shown = guest.entities.find((entry) => entry.id === body.id)!;
            expect(preview[index].x, card).toBeCloseTo(shown.x, 11);
            expect(preview[index].y, card).toBeCloseTo(shown.y, 11);
          }
          expect(host.entities).toEqual(before);
          expect((host as any).randomState).toBe(rng);
          const twice = perspective(perspective(snapshot(host), "red"), "red");
          expect(Object.hasOwn(twice, "nativeArmyViewMirrored")).toBe(false);
          host.entities = [];
          applySnapshot(guest, snapshot(host), view);
          expect(guest.nativeGroupFormation).toBe(
            hostVersion === 35 ? true : undefined,
          );
        }
    });
it("clears the newer group policy without discarding an older host's native Army view", () => {
  const guest = make();
  applySnapshot(guest, snapshot(make()), "red");
  expect(guest.nativeGroupFormation).toBe(true);
  applySnapshot(guest, snapshot(make(34)), "red");
  expect(guest.nativeGroupFormation).toBeUndefined();
  expect(guest.nativeArmyFormation).toBe(true);
  expect(guest.nativeArmyViewMirrored).toBe(true);
  applySnapshot(guest, snapshot(make(33)), "red");
  expect(guest.nativeGroupFormation).toBeUndefined();
  expect(guest.nativeArmyFormation).toBeUndefined();
  expect(guest.nativeArmyViewMirrored).toBeUndefined();
});
it("starts Mirror groups with fresh canonical lane geometry and mixed character order", () => {
  for (const card of ["archers", "bats", "goblin-gang"] as const)
    for (const team of ["blue", "red"] as const) {
      const b = make(),
        y = team === "blue" ? 22 : 10;
      const first = cast(b, card, team, 3.5, y);
      const second = cast(b, "mirror", team, 14.5, y);
      const row = native.cases.find(
        (row: any) =>
          row.section === "Map" &&
          row.card === card &&
          row.ownerIndex === (team === "red" ? 0 : 1) &&
          row.center.x === 14500,
      );
      expect(second).toHaveLength(first.length);
      for (const [index, body] of second.entries()) {
        expect(body.id).toBeGreaterThan(first.at(-1)!.id);
        expect(body.x).toBeCloseTo(row.children[index].x / 1000, 12);
        expect(body.y).toBeCloseTo(
          y + (row.children[index].y - 16000) / 1000,
          12,
        );
      }
    }
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
it("preserves complete rules-34 games, policy fields, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("0cbbc1d");
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
it("records and replays a complete current game with actual physical group deployments", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 35, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let groups = false;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    groups ||= live.entities.some((body) => body.card === "archers");
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(groups).toBe(true);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(35);
  expect(replay.nativeGroupFormation).toBe(true);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
