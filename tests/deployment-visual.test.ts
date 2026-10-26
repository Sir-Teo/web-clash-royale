import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { deploymentVisualDelay } from "../src/game/deployment";
import { perspective, snapshot } from "../src/network/perspective";
import manifest from "../reference/client/deployment-visual-manifest.json";
import golden from "./fixtures/deployment-presentation-golden.json";

function scene(id: CardId, team: Team, version: 17 | 18 = 18) {
  const initial = new Battle({ seed: 5, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  battle.players[team].hand[0] = id;
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
  return battle;
}
const offsets = (battle: Battle) =>
  battle.entities
    .filter((e) => e.kind === "troop")
    .map((e) => e.deployVisualDelay ?? 0);

describe("native card group deployment presentation", () => {
  it("pins its archived character bindings and native timer trace", () => {
    for (const entry of [...manifest.inputs, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
      ).toBe(entry.sha256);
  });
  for (const team of ["blue", "red"] as const) {
    it.each([
      ["three-musketeers", [0, 0.1, 0.2]],
      ["archers", [0, 0.2]],
      ["minion-horde", [0, 0.066, 0.133, 0.2, 0.266, 0.333]],
      ["bats", [0, 0.08, 0.16, 0.24, 0.32]],
      ["guards", [0, 0.133, 0.266]],
      ["fire-spirits", [0, 0.133, 0.266]],
    ] as const)(
      "retains independent %s visual clocks for " + team,
      (id, expected) => {
        const battle = scene(id, team);
        expect(offsets(battle)).toEqual(expected);
        expect(
          battle.entities
            .filter((e) => e.kind === "troop")
            .every((e) => e.deploy === 1),
        ).toBe(true);
        const guest = perspective(snapshot(battle), team);
        expect(
          guest.entities
            .filter((e) => e.kind === "troop")
            .map((e) => e.deployVisualDelay ?? 0),
        ).toEqual(expected);
        expect(offsets(scene(id, team, 17))).toEqual(expected.map(() => 0));
      },
    );
  }
  it("keeps two same-tick mirrored groups independent and retains offsets after a body dies", () => {
    const battle = scene("archers", "blue");
    battle.players.blue.hand[0] = "mirror";
    expect(battle.play("blue", 0, 14, 22).ok).toBe(true);
    expect(offsets(battle)).toEqual([0, 0.2, 0, 0.2]);
    const first = battle.entities.find((e) => e.card === "archers")!;
    (battle as any).hurt(first, first.hp);
    battle.step();
    expect(offsets(battle)).toEqual([0.2, 0, 0.2]);
  });
  it("leaves single troops, mixed formations and invalid group indices unshifted", () => {
    expect(offsets(scene("musketeer", "blue"))).toEqual([0]);
    expect(offsets(scene("goblin-gang", "blue"))).toEqual([0, 0, 0, 0, 0, 0]);
    for (const [index, count] of [
      [-1, 3],
      [3, 3],
      [0, 0],
      [0.5, 3],
      [0, 2.5],
    ])
      expect(deploymentVisualDelay("archers", index, count)).toBe(0);
  });
});

// The new field is presentation metadata. Preserve every other retained field
// from an independently rebuilt complete rules-18 match before adding it.
it("preserves the complete earlier rules-18 match apart from its visual offset metadata", () => {
  expect(golden.sourceCommit).toBe("2c79362");
  const digest = (battle: Battle) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          tick: battle.tick,
          entities: battle.entities.map(
            ({ deployVisualDelay: _visual, ...entity }) => entity,
          ),
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
  for (const row of golden.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
      expect(digest(battle), `tick ${checkpoint.tick}`).toBe(checkpoint.digest);
    }
  }
});
