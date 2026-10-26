import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import { CARD_MAP } from "../src/game/cards";
import {
  deploymentPositions,
  goblinGangCharacter,
} from "../src/game/deployment";
import { nativeFormationOffset } from "../src/game/native-formation";
import { perspective, snapshot } from "../src/network/perspective";
import source from "../reference/client/mixed-formation-native-trace.json";
import native from "./fixtures/native-mixed-formation-golden.json";
import historical from "./fixtures/mixed-formation-rules21-golden.json";

const card = (name: string) =>
  name === "Goblin" ? "goblins" : "spear-goblins";
function scene(
  team: Team,
  ownX = 4,
  version: Replay["version"] = 22,
  mirror = false,
) {
  const initial = new Battle({ seed: 71, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  const x = team === "blue" ? ownX : 18 - ownX;
  const y = team === "blue" ? 22 : 10;
  battle.players[team].hand[0] = mirror ? "mirror" : "goblin-gang";
  battle.players[team].elixir = 10;
  if (mirror) battle.players[team].lastPlayed = "goblin-gang";
  expect(battle.play(team, 0, x, y).ok).toBe(true);
  return { battle, x, y };
}
const bodies = (battle: Battle) =>
  battle.entities.filter((e) => e.kind === "troop");
const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          historical.stateFields.map((key) => [key, (battle as any)[key]]),
        ),
      ),
    )
    .digest("hex");

describe("native mixed Goblin Gang formation", () => {
  it("pins the independent geometry/selector capture and source profile", () => {
    expect(native.sha256).toBe(
      "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
    );
    expect(native.emulator).toBe("unicorn 2.1.4");
    expect(native.cases).toHaveLength(8);
    expect(native.signCases).toHaveLength(24);
    expect(source.blocks).toHaveLength(9);
    expect(source.profile).toEqual({
      card: "GoblinGang",
      primary: "Goblin",
      secondary: "SpearGoblin",
      count: 6,
      radius: 700,
      angleShift: 0,
    });
    for (const entry of source.inputs)
      expect(
        createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
      ).toBe(entry.sha256);
    for (const row of native.signCases) {
      if (!row.hasSecondary || row.y === 0)
        expect(row.character).toBe("Goblin");
      else
        expect(row.character).toBe(
          (row.ownerIndex % 2 ? row.y > 0 : row.y < 0)
            ? "SpearGoblin"
            : "Goblin",
        );
    }
  });

  it.each(native.cases)(
    "matches captured integer offsets and creation order %#",
    (row) => {
      expect(row.flipY).toBe(row.ownerIndex % 2 === 0);
      for (const point of row.points) {
        expect(
          nativeFormationOffset(
            point.index,
            6,
            700,
            0,
            row.flipY,
            row.lane as 0 | 1,
          ),
        ).toEqual({ x: point.x, y: point.y });
        expect(goblinGangCharacter(point.index)).toBe(card(point.character));
      }
    },
  );

  for (const team of ["blue", "red"] as const)
    for (const ownX of [4, 14])
      it(`places the native troop types and matches the ${team} lane-${ownX} preview`, () => {
        const { battle, x, y } = scene(team, ownX);
        const row = native.cases.find(
          (c) => c.ownerIndex === 1 && c.lane === (ownX > 9 ? 1 : 0),
        )!;
        const rotation = team === "blue" ? 1 : -1;
        expect(bodies(battle)).toHaveLength(6);
        bodies(battle).forEach((body, index) => {
          const expected = row.points[index];
          expect(body.card).toBe(card(expected.character));
          expect(body.x).toBeCloseTo(x + (rotation * expected.x) / 1000, 10);
          expect(body.y).toBeCloseTo(y + (rotation * expected.y) / 1000, 10);
          expect(body.hp).toBe(CARD_MAP[body.card].hp);
          expect(body.deploy).toBe(1);
        });
        const preview = deploymentPositions("goblin-gang", { x: ownX, y: 22 });
        perspective(snapshot(battle), team)
          .entities.filter((e) => e.kind === "troop")
          .forEach((body, index) => {
            expect(body.x).toBeCloseTo(preview[index].x, 10);
            expect(body.y).toBeCloseTo(preview[index].y, 10);
            expect(body.card).toBe(goblinGangCharacter(index));
          });
      });

  it.each(Array.from({ length: 21 }, (_, i) => (i + 1) as Replay["version"]))(
    "preserves origin rules %i geometry and troop order",
    (version) => {
      for (const team of ["blue", "red"] as const) {
        const { battle, x, y } = scene(team, 4, version);
        const old = deploymentPositions(
          "goblin-gang",
          { x, y },
          team,
          undefined,
          21,
        );
        bodies(battle).forEach((body, index) => {
          expect({ x: body.x, y: body.y }).toEqual(old[index]);
          expect(body.card).toBe(index < 3 ? "goblins" : "spear-goblins");
        });
      }
    },
  );

  it.each(["blue", "red"] as const)(
    "Mirror keeps native child types and source stats for %s",
    (team) => {
      const { battle, x, y } = scene(team, 4, 22, true);
      const expected = deploymentPositions("goblin-gang", { x, y }, team);
      bodies(battle).forEach((body, index) => {
        expect(body.card).toBe(goblinGangCharacter(index));
        expect({ x: body.x, y: body.y }).toEqual(expected[index]);
        expect(body.hp).toBe(CARD_MAP[body.card].hp);
      });
      expect(battle.players[team].elixir).toBe(6);
    },
  );

  it.each(["blue", "red"] as const)(
    "edge clamps do not reassign mixed types for %s",
    (team) => {
      const positions = deploymentPositions(
        "goblin-gang",
        { x: 0.6, y: team === "blue" ? 31 : 1 },
        team,
      );
      positions.forEach((p) => {
        expect(p.x).toBeGreaterThanOrEqual(0.6);
        expect(p.x).toBeLessThanOrEqual(17.4);
        expect(p.y).toBeGreaterThanOrEqual(0.8);
        expect(p.y).toBeLessThanOrEqual(31.2);
      });
      expect(positions.filter((p) => p.x === 0.6).length).toBeGreaterThan(1);
      expect(positions.map((_, i) => goblinGangCharacter(i))).toEqual(
        native.cases[0].points.map((p) => card(p.character)),
      );
    },
  );

  it("reproduces every complete rules-21 state/RNG checkpoint", () => {
    expect(historical.sourceCommit).toBe("1601c0d");
    expect(historical.cases).toHaveLength(3);
    for (const row of historical.cases) {
      expect(row.groups.blue).toBeGreaterThan(0);
      expect(row.groups.red).toBeGreaterThan(0);
      const battle = new Battle({ replay: row.replay as Replay });
      for (const checkpoint of row.checkpoints) {
        while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
        expect(digest(battle), `${row.replay.seed}:${checkpoint.tick}`).toBe(
          checkpoint.digest,
        );
      }
    }
  });

  it("records and exactly replays a complete current match with both mixed groups", () => {
    const old = historical.cases[0].replay;
    const live = new Battle({
      replay: { ...old, version: 22, actions: [], duration: 12000 } as Replay,
    });
    const checkpoints: { tick: number; digest: string }[] = [];
    while (!live.winner && live.tick < 12000) {
      for (const a of old.actions.filter((a) => a.tick === live.tick)) {
        const team = a.team as Team;
        const slot = live.players[team].hand.indexOf(a.card as any);
        if (slot >= 0) live.play(team, slot, a.x, a.y);
      }
      live.step();
      if (live.tick % 300 === 0 || live.winner)
        checkpoints.push({ tick: live.tick, digest: digest(live) });
    }
    expect(live.winner).toBeTruthy();
    expect(
      live.actions.some((a) => a.card === "goblin-gang" && a.team === "blue"),
    ).toBe(true);
    expect(
      live.actions.some((a) => a.card === "goblin-gang" && a.team === "red"),
    ).toBe(true);
    const replay = new Battle({ replay: live.exportReplay() });
    expect(replay.rulesVersion).toBe(22);
    for (const checkpoint of checkpoints) {
      while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
      expect(digest(replay), `current:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
    expect(replay.time).toBe(replay.tick * STEP);
  });
});
