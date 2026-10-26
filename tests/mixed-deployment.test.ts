import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as T from "three";
import { Battle, type Replay, type Team } from "../src/game/engine";
import { deploymentVisualDelay } from "../src/game/deployment";
import { perspective, snapshot } from "../src/network/perspective";
import { NativeDeployFilter } from "../src/render/deploy-filter";
import {
  makeMaterial,
  type AnimatedSprite,
  type SpriteAsset,
} from "../src/render/sprites";
import source from "../reference/client/mixed-deployment-native-trace.json";
import native from "./fixtures/native-mixed-deployment-golden.json";
import historical from "./fixtures/mixed-deployment-presentation-golden.json";

const expected = [0.1, 0.166, 0.233, 0.3, 0.366, 0.033];
const troops = (battle: Battle) =>
  battle.entities.filter((e) => e.kind === "troop");
function scene(team: Team = "blue", version: Replay["version"] = 22) {
  const initial = new Battle({ seed: 17, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  battle.players[team].hand[0] = "goblin-gang";
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
  return battle;
}

describe("native mixed-group deployment presentation", () => {
  it("pins the source angular branch and captured integer timing", () => {
    expect(source.sha256).toBe(
      "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
    );
    expect(source.blocks).toHaveLength(13);
    expect(source.profile.deployDelayMs).toEqual({
      Goblin: 400,
      SpearGoblin: 400,
    });
    expect(native.cases).toHaveLength(8);
    expect(native.axisCases).toHaveLength(18);
    for (const entry of source.inputs)
      expect(
        createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
      ).toBe(entry.sha256);
    // Zero-vector behavior also proves the even-owner branch uses 360-angle,
    // rather than normalizing that value back to zero before scaling.
    expect(
      native.axisCases
        .filter((c) => c.x === 0 && c.y === 0)
        .map((c) => [c.angle, c.visualDelayMs]),
    ).toEqual([
      [0, 400],
      [0, 0],
    ]);
  });

  it.each(native.cases)(
    "matches all six native delays for owner/lane case %#",
    (row) => {
      expect(row.points.map((p) => p.visualDelayMs / 1000)).toEqual(expected);
      row.points.forEach((point) =>
        expect(deploymentVisualDelay("goblin-gang", point.index, 6)).toBe(
          point.visualDelayMs / 1000,
        ),
      );
    },
  );

  it.each(["blue", "red"] as const)(
    "retains %s per-body offsets through snapshots without extending combat deployment",
    (team) => {
      const battle = scene(team);
      expect(troops(battle).map((e) => e.deployVisualDelay)).toEqual(expected);
      expect(troops(battle).every((e) => e.deploy === 1)).toBe(true);
      expect(
        perspective(snapshot(battle), team)
          .entities.filter((e) => e.kind === "troop")
          .map((e) => e.deployVisualDelay),
      ).toEqual(expected);
      for (let i = 0; i < 32; i++) battle.step();
      expect(troops(battle)).toHaveLength(6);
      expect(troops(battle).every((e) => e.deploy <= 0 && e.age > 1)).toBe(
        true,
      );
      expect(troops(battle).map((e) => e.deployVisualDelay)).toEqual(expected);
    },
  );

  it("keeps two same-tick groups independent, including a mirrored group and a body dying", () => {
    const battle = scene();
    battle.players.blue.hand[0] = "mirror";
    expect(battle.play("blue", 0, 14, 22).ok).toBe(true);
    expect(troops(battle).map((e) => e.deployVisualDelay)).toEqual([
      ...expected,
      ...expected,
    ]);
    const first = troops(battle)[0];
    (battle as any).hurt(first, first.hp);
    battle.step();
    expect(troops(battle).map((e) => e.deployVisualDelay)).toEqual([
      ...expected.slice(1),
      ...expected,
    ]);
  });

  it.each(Array.from({ length: 21 }, (_, i) => (i + 1) as Replay["version"]))(
    "leaves rules %i mixed bodies unshifted",
    (version) => {
      expect(
        troops(scene("blue", version)).every(
          (e) => e.deployVisualDelay === undefined,
        ),
      ).toBe(true);
    },
  );

  it("rejects incomplete or invalid mixed body indices", () => {
    for (const [index, count] of [
      [-1, 6],
      [6, 6],
      [0, 5],
      [0, 0],
      [0.5, 6],
      [0, 6.5],
    ])
      expect(deploymentVisualDelay("goblin-gang", index, count)).toBe(0);
  });

  it("recovers distinct authored filter poses after late artwork and a rebuild without changing entities", () => {
    const entities = troops(scene());
    entities.forEach((e) => (e.age = 0.1));
    const sprites = new Map(
      entities.map((e) => {
        const materials = [makeMaterial(new T.Texture())];
        const sprite: AnimatedSprite = {
          mesh: new T.Mesh(new T.BufferGeometry(), materials),
          asset: { materials, scale: 0.02 } as SpriteAsset,
          lastFrame: 0,
          facingX: 0,
          facingY: 0,
        };
        return [e.id, sprite];
      }),
    );
    const filter = new NativeDeployFilter();
    try {
      filter.update(entities, () => undefined);
      expect(filter.state).toEqual([]);
      const update = () => {
        for (const sprite of sprites.values()) {
          sprite.mesh.scale.set(1, 1, 1);
          sprite.mesh.position.y = 0;
        }
        const before = structuredClone(entities);
        filter.update(entities, (id) => sprites.get(id));
        expect(entities).toEqual(before);
        return filter.state.map((e) => e.frame);
      };
      expect(update()).toEqual([0, 0, 0, 0, 0, 4]);
      expect(update()).toEqual([0, 0, 0, 0, 0, 4]);
      filter.clear();
      expect(update()).toEqual([0, 0, 0, 0, 0, 4]);
      entities.forEach((e) => (e.age = 0.4));
      expect(update()).toEqual([18, 14, 10, 6, 2, 22]);
    } finally {
      filter.clear();
      for (const sprite of sprites.values()) {
        sprite.mesh.geometry.dispose();
        sprite.asset.materials.forEach((material) => {
          material.map?.dispose();
          material.dispose();
        });
      }
    }
  });

  it("preserves complete earlier rules-22 matches except the visual-offset field", () => {
    expect(historical.sourceCommit).toBe("e6a571a");
    expect(historical.excludedPresentationFields).toEqual([
      "entities[].deployVisualDelay",
    ]);
    expect(historical.cases).toHaveLength(3);
    const digest = (battle: Battle) =>
      createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              historical.stateFields.map((key) => [
                key,
                key === "entities"
                  ? battle.entities.map(
                      ({ deployVisualDelay: _visual, ...entity }) => entity,
                    )
                  : (battle as any)[key],
              ]),
            ),
          ),
        )
        .digest("hex");
    for (const row of historical.cases) {
      const battle = new Battle({ replay: row.replay as Replay });
      for (const checkpoint of row.checkpoints) {
        while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
        expect(digest(battle), `${row.replay.seed}:${checkpoint.tick}`).toBe(
          checkpoint.digest,
        );
      }
    }
  });
});
