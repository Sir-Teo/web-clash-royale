import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId, CARD_MAP } from "../src/game/cards";
import {
  deploymentYBounds,
  clampDeploymentY,
} from "../src/game/placement-bounds";
import { deploymentPositions } from "../src/game/deployment";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import data from "../src/game/placement-bounds-data.json";
import golden from "./fixtures/placement-bounds-rules35-golden.json";
const native = JSON.parse(
  readFileSync("reference/client/placement-bounds-native-trace.json", "utf8"),
);
const teamOf = (index: number): Team => (index % 2 ? "blue" : "red");
function battle(version: Replay["version"] = 36) {
  const b = new Battle({
    replay: { ...new Battle({ seed: 783, ai: false }).exportReplay(), version },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(b: Battle, card: CardId, team: Team, x: number, y: number) {
  b.players[team].elixir = 10;
  b.players[team].hand[0] = card;
  const ids = new Set(b.entities.map((e) => e.id));
  expect(b.play(team, 0, x, y).ok).toBe(true);
  return b.entities.filter((e) => !ids.has(e.id));
}
function bodies(entries: any[]): Entity[] {
  return entries.map(
    (e, index) =>
      ({
        id: index + 1,
        card:
          e.source === "Cannon"
            ? "cannon"
            : e.source === "Knight"
              ? "knight"
              : "tower",
        kind:
          e.source === "Cannon"
            ? "building"
            : e.source === "Knight"
              ? "troop"
              : "tower",
        team: teamOf(e.owner),
        king: e.source === "KingTower",
        hp: e.inactive ? 0 : 100,
        x: e.x / 1000,
        y: e.y / 1000,
      }) as Entity,
  );
}
it("pins all native placement inputs, projection and regular source inventory", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/placement-bounds-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(Object.keys(data.cards)).toHaveLength(48);
  expect(Object.keys(data.bodies)).toHaveLength(13);
});
for (const scenario of [
  ...new Set<string>(native.cases.map((r: any) => r.scenario)),
])
  it(`matches native column bounds for ${scenario}`, () => {
    for (const row of native.cases.filter(
      (r: any) => r.scenario === scenario,
    )) {
      const expected =
        row.bounds[0] === -2147483648
          ? undefined
          : row.bounds.map((value: number) => value / 1000);
      expect(
        deploymentYBounds(
          "archers",
          bodies(row.entries),
          teamOf(row.ownerIndex),
          row.sourceX / 1000,
        ),
        JSON.stringify(row),
      ).toEqual(expected);
    }
  });
it("matches native physical footprints, targetability, moving classes, parity and enemy-side controls", () => {
  for (const row of native.controls.filter(
    (r: any) =>
      r.providedAccountCount === 2 &&
      !r.excludeDeployControl &&
      r.kind !== "suppliedColumnSpan",
  )) {
    const expected =
      row.bounds[0] === -2147483648
        ? undefined
        : row.bounds.map((v: number) => v / 1000);
    expect(
      deploymentYBounds(
        row.canDeployOnEnemySide ? "miner" : "archers",
        bodies(row.entries),
        teamOf(row.ownerIndex),
        row.sourceX / 1000,
      ),
    ).toEqual(expected);
  }
});
it("matches native optional ground clamps and absent-bound controls", () => {
  for (const row of native.clamps.filter((r: any) => r.flyingHeight === 0))
    expect(
      clampDeploymentY(
        row.requestedY / 1000,
        row.hasBounds ? row.bounds.map((v: number) => v / 1000) : undefined,
      ),
    ).toBeCloseTo(row.resultY / 1000, 10);
});
for (const card of Object.keys(data.cards) as CardId[])
  it(`selects the source ground/flying boundary policy for ${card}`, () => {
    const profile = data.cards[card as keyof typeof data.cards];
    expect(deploymentYBounds(card, battle().entities, "blue", 4)).toEqual(
      profile.flying || profile.canDeployOnEnemySide ? undefined : [17.499, 31],
    );
  });
for (const team of ["blue", "red"] as const)
  for (const card of [
    "goblins",
    "guards",
    "three-musketeers",
    "fire-spirits",
    "skeletons",
    "skeleton-army",
    "goblin-gang",
    "bats",
    "minions",
  ] as const)
    it(`places ${team} ${card} at source ground bounds with unchanged flying requests`, () => {
      const b = battle(),
        point = { x: 4, y: team === "blue" ? 17.8 : 14.2 };
      const before = snapshot(b),
        rng = (b as any).randomState;
      const bounds = deploymentYBounds(card, b.entities, team, point.x);
      const old = deploymentPositions(card, point, team, undefined, 35),
        expected = old.map((p) => ({ ...p, y: clampDeploymentY(p.y, bounds) }));
      const spawned = cast(b, card, team, point.x, point.y);
      expect(spawned.map(({ x, y }) => ({ x, y }))).toEqual(expected);
      expect(spawned).toHaveLength(CARD_MAP[card].count);
      expect((b as any).randomState).toBe(rng);
      expect(snapshot(b).nativeGroundDeployment).toBe(true);
      if (bounds && old.some((p) => p.y < bounds[0] || p.y > bounds[1]))
        expect(expected).not.toEqual(old);
      expect(before.entities.filter((e) => e.kind === "tower")).toEqual(
        b.entities.filter((e) => e.kind === "tower"),
      );
    });
it("clamps single ground requests at the back while preserving building and old-rule geometry", () => {
  const current = battle(),
    old = battle(35);
  expect(cast(current, "knight", "blue", 4, 31.2)[0].y).toBe(31);
  expect(cast(old, "knight", "blue", 4, 31.2)[0].y).toBe(31.2);
  expect(cast(current, "cannon", "red", 14, 0.8)[0].y).toBe(0.8);
  expect(
    deploymentYBounds("cannon", current.entities, "red", 14),
  ).toBeUndefined();
  expect(
    deploymentPositions(
      "guards",
      { x: 4, y: 17.8 },
      "blue",
      undefined,
      35,
      undefined,
      [17.499, 31],
    ),
  ).toEqual(
    deploymentPositions("guards", { x: 4, y: 17.8 }, "blue", undefined, 35),
  );
});
it("drops only the affected column bound when a Princess is gone, without mutating the world", () => {
  const b = battle();
  const p = b.entities.find(
    (e) => e.team === "red" && !e.king && e.kind === "tower" && e.x < 9,
  )!;
  p.hp = 0;
  const original = JSON.stringify(snapshot(b));
  expect(deploymentYBounds("guards", b.entities, "blue", 3.5)).toBeUndefined();
  expect(deploymentYBounds("guards", b.entities, "blue", 9)).toEqual([
    17.499, 31,
  ]);
  expect(JSON.stringify(snapshot(b))).toBe(original);
});
for (const hostVersion of [35, 36] as const)
  for (const view of ["blue", "red"] as const)
    it(`keeps host-${hostVersion} bounds and edge previews through ${view} perspective`, () => {
      for (const card of ["guards", "skeleton-army", "bats"] as const)
        for (const x of [0.999, 1, 4, 8.999, 9, 14, 17.001]) {
          const host = battle(hostVersion),
            team = view,
            point = { x, y: team === "blue" ? 17.8 : 14.2 };
          const original = JSON.stringify(snapshot(host)),
            rng = (host as any).randomState;
          const wrapper = battle(hostVersion === 36 ? 35 : 36);
          applySnapshot(wrapper, snapshot(host), view);
          const guestPoint =
            view === "red" ? { x: 18 - x, y: 32 - point.y } : point;
          const bounds = wrapper.nativeGroundDeployment
            ? deploymentYBounds(
                card,
                wrapper.entities,
                "blue",
                guestPoint.x,
                wrapper.nativeArmyViewMirrored,
              )
            : undefined;
          const preview = deploymentPositions(
            card,
            guestPoint,
            "blue",
            undefined,
            wrapper.nativeGroundDeployment ? 36 : 35,
            wrapper.nativeArmyViewMirrored,
            bounds,
          );
          expect(JSON.stringify(snapshot(host))).toBe(original);
          expect((host as any).randomState).toBe(rng);
          const ids = new Set(host.entities.map((e) => e.id));
          cast(host, card, team, x, point.y);
          const incoming = perspective(snapshot(host), view).entities.filter(
            (e) => !ids.has(e.id),
          );
          for (const [index, body] of incoming.entries()) {
            expect(preview[index].x).toBeCloseTo(body.x, 10);
            expect(preview[index].y).toBeCloseTo(body.y, 10);
          }
          const twice = perspective(perspective(snapshot(host), "red"), "red");
          expect(twice.nativeArmyViewMirrored).toBeUndefined();
          expect(twice.nativeGroundDeployment).toBe(
            host.nativeGroundDeployment,
          );
        }
    });
it("retains the host policy for empty worlds and clears it when the host changes", () => {
  const guest = battle(35),
    host = battle();
  host.entities = [];
  applySnapshot(guest, snapshot(host), "red");
  expect(guest.nativeGroundDeployment).toBe(true);
  expect(guest.nativeArmyViewMirrored).toBe(true);
  const old = battle(35);
  old.entities = [];
  applySnapshot(guest, snapshot(old), "red");
  expect(guest.nativeGroundDeployment).toBeUndefined();
  expect(guest.nativeGroupFormation).toBe(true);
});
it("Mirror uses fresh source ground bounds and neither cast consumes RNG", () => {
  const b = battle(),
    rng = (b as any).randomState;
  cast(b, "guards", "blue", 4, 17.8);
  b.players.blue.lastPlayed = "guards";
  const mirrored = cast(b, "mirror", "blue", 14, 17.8);
  expect(mirrored).toHaveLength(3);
  expect(mirrored.every((e) => e.y >= 17.499)).toBe(true);
  expect((b as any).randomState).toBe(rng);
});
for (const team of ["blue", "red"] as const)
  for (const card of ["guards", "skeleton-army", "goblin-gang"] as const)
    it(`releases bounded ${team} ${card} into live movement and Crown damage`, () => {
      const b = battle(),
        point = { x: 4, y: team === "blue" ? 17.8 : 14.2 };
      const children = cast(b, card, team, point.x, point.y);
      const target = b.entities.find(
        (e) => e.kind === "tower" && !e.king && e.team !== team && e.x < 9,
      )!;
      const health = target.hp,
        starts = children.map((e) => ({ x: e.x, y: e.y }));
      for (let tick = 0; tick < 1200 && target.hp === health; tick++) b.step();
      expect(children.every((e) => e.deploy <= 0)).toBe(true);
      expect(
        children.some(
          (e, index) =>
            Math.hypot(e.x - starts[index].x, e.y - starts[index].y) > 1,
        ),
      ).toBe(true);
      expect(target.hp).toBeLessThan(health);
      expect(
        children.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y)),
      ).toBe(true);
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
it("preserves complete historical rules-35 worlds, actions and RNG", () => {
  for (const sample of golden.cases) {
    const b = new Battle({ replay: sample.replay as Replay });
    if (sample.ai) {
      (b as any).ai = true;
      (b as any).replayActions = null;
    }
    for (const checkpoint of sample.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (sample.ai)
          for (const action of sample.replay.actions.filter(
            (action) => action.team === "blue" && action.tick === b.tick,
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
      expect(digest(b)).toBe(checkpoint.digest);
    }
  }
});
it("records and replays a current full game with source-ground deployments", () => {
  const old = golden.cases[0].replay;
  const b = new Battle({
    replay: { ...old, version: 36, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints = [];
  let bounded = false;
  while (!b.winner && b.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === b.tick,
    )) {
      const team = action.team as Team,
        card = action.card as CardId,
        slot = b.players[team].hand.indexOf(card);
      const y =
        CARD_MAP[card].kind === "spell"
          ? action.y
          : team === "blue"
            ? 17.8
            : 14.2;
      if (slot >= 0) b.play(team, slot, action.x, y);
    }
    b.step();
    bounded ||= b.entities.some((e) => e.card === "archers");
    if (b.tick % 300 === 0 || b.winner)
      checkpoints.push({ tick: b.tick, digest: digest(b) });
  }
  expect(b.winner).toBeTruthy();
  expect(bounded).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  expect(replay.rulesVersion).toBe(36);
  expect(replay.nativeGroundDeployment).toBe(true);
  for (const point of checkpoints) {
    while (replay.tick < point.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(point.digest);
  }
});
