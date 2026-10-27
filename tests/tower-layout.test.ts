import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import {
  TOWER_SITES,
  NATIVE_TOWER_SITES,
  destroyedTowerSites,
} from "../src/game/arena-layout";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import historical from "./fixtures/tower-layout-rules30-golden.json";

const native = JSON.parse(
  readFileSync("reference/client/tower-layout-native-trace.json", "utf8"),
);
function make(version: Replay["version"] = 31) {
  const initial = new Battle({ seed: 3101, ai: false });
  return new Battle({ replay: { ...initial.exportReplay(), version } });
}
it("pins native coordinate stores and every imported source/output hash", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/tower-layout-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  const rows = native.cases.filter((row: any) => row.section === "LayoutPvp");
  expect(rows).toHaveLength(6);
  for (const site of NATIVE_TOWER_SITES) {
    const source = rows.find(
      (row: any) =>
        row.nativePoint.x === site.x * 1000 &&
        row.nativePoint.y === site.y * 1000,
    );
    expect(source.sourceCharacter).toBe(
      site.king ? "KingTower" : "PrincessTower",
    );
    expect(source.nativePoint).toEqual({
      x: source.gridPoint.x * 500,
      y: source.gridPoint.y * 500,
    });
  }
});
it("preserves all historical Crown coordinates and IDs through rules 30", () => {
  for (let version = 1; version <= 30; version++) {
    const match = make(version as Replay["version"]);
    expect(match.nativeTowerLayout).toBeUndefined();
    expect(
      match.entities.map(({ team, x, y, king, lane }) => ({
        team,
        x,
        y,
        king,
        ...(lane ? { lane } : {}),
      })),
    ).toEqual(TOWER_SITES);
    expect(Object.hasOwn(snapshot(match), "nativeTowerLayout")).toBe(false);
  }
});
it("places current Crowns at source coordinates in stable browser ID order", () => {
  const match = make();
  expect(match.rulesVersion).toBe(31);
  expect(match.nativeTowerLayout).toBe(true);
  expect(
    match.entities.map(({ id, team, x, y, king, lane }) => ({
      id,
      team,
      x,
      y,
      king,
      ...(lane ? { lane } : {}),
    })),
  ).toEqual(
    NATIVE_TOWER_SITES.map((site, index) => ({ id: index + 1, ...site })),
  );
  expect(destroyedTowerSites(match.entities, match.nativeTowerLayout)).toEqual(
    [],
  );
});
for (const version of [30, 31] as const)
  it.each(["blue", "red"] as const)(
    `keeps actual Crown attacks anchored to rules-${version} source positions (%s)`,
    (team) => {
      const match = make(version),
        enemy = team === "blue" ? "red" : "blue";
      for (const body of match.entities) body.active = false;
      const tower = match.entities.find(
        (body) => body.team === team && body.lane === "left",
      )!;
      tower.active = true;
      const y = tower.y + (team === "red" ? 1 : -1) * 9.25;
      (match as any).spawn("giant", enemy, tower.x, y);
      const target = match.entities.at(-1)!;
      Object.assign(target, {
        x: tower.x,
        y,
        active: false,
        deploy: 0,
        speed: 0,
        hp: 1e6,
        maxHp: 1e6,
      });
      for (let tick = 0; tick < 90; tick++) match.step();
      expect(tower.target).toBe(target.id);
      expect(target.hp).toBeLessThan(1e6);
      target.hp = 1e6;
      target.y += team === "red" ? 0.001 : -0.001;
      match.projectiles = [];
      tower.target = null;
      tower.pendingAttack = undefined;
      for (let tick = 0; tick < 90; tick++) match.step();
      expect(target.hp).toBe(1e6);
    },
  );
for (const version of [30, 31] as const)
  it.each(["blue", "red"] as const)(
    `preserves the host's rules-${version} layout across opposite-version guests (%s)`,
    (team) => {
      const host = make(version),
        guest = make(version === 31 ? 30 : 31);
      const state = snapshot(host);
      applySnapshot(guest, state, team);
      expect(guest.nativeTowerLayout).toBe(host.nativeTowerLayout);
      expect(
        destroyedTowerSites(guest.entities, guest.nativeTowerLayout),
      ).toEqual([]);
      const king = guest.entities.find(
        (body) => body.team === "red" && body.king,
      )!;
      const princess = guest.entities.find(
        (body) => body.team === "blue" && body.lane === "left",
      )!;
      king.hp = 0;
      princess.hp = 0;
      expect(
        destroyedTowerSites(guest.entities, guest.nativeTowerLayout),
      ).toEqual([
        { team: "red", x: 9, y: version === 31 ? 3 : 2.5, king: true },
        {
          team: "blue",
          x: version === 31 ? 3.5 : 4,
          y: version === 31 ? 25.5 : 26,
          king: false,
          lane: "left",
        },
      ]);
      const empty = perspective({ ...state, entities: [] }, team);
      applySnapshot(guest, empty, "blue");
      expect(
        destroyedTowerSites(guest.entities, guest.nativeTowerLayout),
      ).toHaveLength(6);
      expect(guest.nativeTowerLayout).toBe(version === 31 ? true : undefined);
    },
  );

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
it("preserves complete rules-30 matches with Barrel landings, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("b754b52");
  expect(
    historical.cases.reduce((sum, row) => sum + row.towerDeaths, 0),
  ).toBeGreaterThan(0);
  expect(
    historical.cases.reduce((sum, row) => sum + row.barrelLandings, 0),
  ).toBeGreaterThan(0);
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
it("records and replays a complete current game with actual scored Barrel children", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 31, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let scoredChildren = false;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (action) => action.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    scoredChildren ||= live.entities.some(
      (body) => (body.targetScoreBias ?? 0) > 0,
    );
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(scoredChildren).toBe(true);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(31);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
