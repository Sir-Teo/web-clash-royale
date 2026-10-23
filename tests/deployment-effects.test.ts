import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import { Battle } from "../src/game/engine";
import { CARDS } from "../src/game/cards";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import { NativeDeploymentEffects } from "../src/render/deployment-effects";
import {
  deploymentEffect,
  destructionPlan,
  debrisPose,
  DestructionEffects,
} from "../src/render/destruction";
import { EffectLibrary } from "../src/render/effects";
import { makeMaterial } from "../src/render/sprites";
import definitions from "../src/render/destruction-data.json";
import profiles from "../src/game/combat-data.json";

function play(
  battle: Battle,
  card: "archers" | "knight" | "witch",
  team: "blue" | "red" = "blue",
) {
  battle.players[team].hand[0] = card;
  battle.players[team].elixir = 10;
  battle.play(team, 0, 7, team === "blue" ? 23 : 9);
}

describe("native deployment effects", () => {
  it("resolves every non-spell SpawnEffect from the retained character/building row", async () => {
    const { csvRows } = await import("../scripts/lib/csv.mjs");
    const rows = ["characters", "buildings"].flatMap((name) =>
      csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8")),
    );
    expect(Object.keys(definitions.deployments)).toHaveLength(44);
    for (const card of CARDS) {
      const effect = deploymentEffect(card.id);
      if (card.kind === "spell") {
        expect(effect).toBeUndefined();
        continue;
      }
      const id = card.id as keyof typeof definitions.deployments;
      expect(effect).toBe(`deploy:${id}`);
      const row = rows.find((r: any) => r.Name === profiles[id].source)!;
      expect(definitions.deployments[id].source).toBe(row.SpawnEffect);
    }
    expect(deploymentEffect("constructor")).toBeUndefined();
  });

  it("preserves delayed medium/large bursts, weighted art, shadows and source-empty enemy branches", () => {
    const medium = destructionPlan("deploy:knight", 42);
    expect(medium).toHaveLength(83);
    expect(destructionPlan("deploy:giant", 42)).toHaveLength(133);
    expect(destructionPlan("deploy:mini-pekka", 42)).toHaveLength(133);
    expect(destructionPlan("deploy:pekka", 42, "red")).toEqual([]);
    for (const card of ["goblins", "skeletons", "balloon", "cannon", "tesla"])
      expect(destructionPlan(deploymentEffect(card)!, 42)).toEqual([]);
    expect(medium.every((p) => p.delay >= 0.3 && p.delay < 0.37)).toBe(true);
    expect(medium.filter((p) => p.layer === "Shadow")).toHaveLength(3);
    expect(
      medium.filter(
        (p) => p.emitter === definitions.emitters.knight_deploy_dustPuff2,
      ),
    ).toHaveLength(55);
    expect(definitions.emitters.knight_deploy_dustPuff2.clips).toEqual([
      "d3",
      "d2",
      "d3",
      "d3_green_dark",
    ]);
    const rocks = medium.filter((p) => p.clip.startsWith("Rock"));
    expect(rocks).toHaveLength(13);
    expect(rocks.every((p) => p.layer === "Ground" && !p.ground)).toBe(true);
    expect(debrisPose(rocks[0], 0.1).y).toBeGreaterThan(
      debrisPose(rocks[0], 0).y,
    );
    expect(debrisPose(rocks[0], 3).y).toBe(0.04);
    const manifest = JSON.parse(
      readFileSync("reference/client/manifest.json", "utf8"),
    );
    expect(manifest.ignoredEnemyVersions).toMatchObject([
      {
        effect: "Deploy_ground_fx_largeSize",
        enemyVersion: "giant_skeleton_deploy_enemy",
      },
    ]);
    expect(destructionPlan("deploy:giant", 42, "red")).toEqual(
      destructionPlan("deploy:giant", 42),
    );
  });

  it("uses each Archer's immutable birth position after movement or death and deduplicates snapshots", () => {
    const battle = new Battle({ seed: 12, ai: false }),
      cursor = new NativeDeploymentEffects();
    play(battle, "archers");
    const events = battle.audioEvents.filter((e) => e.phase === "spawn");
    const origins = events.map((e) => ({ ...e.origin! }));
    expect(events).toHaveLength(2);
    expect(origins[0]).not.toEqual(origins[1]);
    battle.entities
      .filter((e) => e.card === "archers")
      .forEach((e) => {
        e.x += 2;
        e.deploy = 0;
      });
    const before = JSON.stringify(snapshot(battle));
    const bursts = cursor.consume(battle.audioEvents, [], battle.seed, 0.8);
    expect(bursts.map((b) => b.origin)).toEqual(origins);
    expect(
      bursts.every((b) => b.age === 0.8 && b.effect === "deploy:archers"),
    ).toBe(true);
    expect(new Set(bursts.map((b) => b.seed)).size).toBe(2);
    expect(
      cursor.consume(battle.audioEvents, battle.entities, battle.seed, 0.9),
    ).toEqual([]);
    expect(JSON.stringify(snapshot(battle))).toBe(before);
    cursor.reset(battle.audioEvents);
    expect(cursor.consume(battle.audioEvents, [], battle.seed, 1)).toEqual([]);
    play(battle, "knight", "red");
    expect(
      cursor.consume(battle.audioEvents, battle.entities, battle.seed, 1),
    ).toHaveLength(1);
  });

  it("rotates the spawn origin through the frontend peer snapshot without mutating the host", () => {
    const host = new Battle({ seed: 29, ai: false });
    play(host, "knight");
    const wire = snapshot(host),
      original = JSON.stringify(wire);
    const guest = new Battle({ seed: host.seed, ai: false });
    applySnapshot(guest, wire, "red");
    const bursts = new NativeDeploymentEffects().consume(
      guest.audioEvents,
      guest.entities,
      guest.seed,
      guest.time,
    );
    expect(bursts).toMatchObject([
      { effect: "deploy:knight", origin: { x: 11, y: 9 }, team: "red", age: 0 },
    ]);
    expect(perspective(wire, "red").lifecycleAudioEvents?.[0].origin).toEqual({
      x: 11,
      y: 9,
    });
    expect(JSON.stringify(wire)).toBe(original);
  });

  it("keeps older hosts compatible without inventing a moved actor's spawn position", () => {
    const battle = new Battle({ seed: 17, ai: false });
    play(battle, "knight");
    const events = battle.audioEvents.map(({ origin, ...e }) => e);
    expect(
      new NativeDeploymentEffects().consume(events, battle.entities, 17, 0.1),
    ).toMatchObject([{ origin: { x: 7, y: 23 }, age: 0.1 }]);
    battle.entities.find((e) => e.card === "knight")!.deploy = 0;
    expect(
      new NativeDeploymentEffects().consume(events, battle.entities, 17, 1.5),
    ).toEqual([]);
    expect(new NativeDeploymentEffects().consume(events, [], 17, 0.1)).toEqual(
      [],
    );
  });

  it("observes actual summoned births while preserving their source-empty particle composition", () => {
    const battle = new Battle({ seed: 7, ai: false }),
      cursor = new NativeDeploymentEffects();
    play(battle, "witch");
    cursor.reset(battle.audioEvents);
    while (
      !battle.audioEvents.some((e) => e.phase === "summon") &&
      battle.time < 10
    )
      battle.step();
    const births = cursor.consume(
      battle.audioEvents,
      battle.entities,
      battle.seed,
      battle.time,
    );
    expect(births).toHaveLength(3);
    expect(births.every((b) => b.effect === "deploy:skeletons")).toBe(true);
    for (const birth of births)
      expect(destructionPlan(birth.effect, birth.seed, birth.team)).toEqual([]);
  });

  it("schedules source delays, batches ground/air artwork and reconstructs late debris without leaks", () => {
    const library = new EffectLibrary();
    const data = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    const textures = data.textures.map(() => new T.Texture());
    library.asset = {
      data,
      textures,
      materials: textures.map(makeMaterial),
      geometry: new Map(),
      scale: 1 / 30,
    };
    const scene = new T.Scene(),
      camera = new T.Camera(),
      effects = new DestructionEffects(scene, library);
    effects.burst("deploy:knight", new T.Vector3(), 42);
    effects.update(0.2, camera);
    expect(effects.count).toBe(83);
    expect(effects.drawCount).toBe(0);
    effects.update(0.3, camera);
    expect(effects.activeClips.d3_green_dark).toBeGreaterThan(0);
    expect(effects.drawCount).toBeLessThan(20);
    expect(
      scene.children.some(
        (o) =>
          (o as T.InstancedMesh).material[0].depthTest && o.renderOrder === 0.2,
      ),
    ).toBe(true);
    const held = scene.children.map((o) => [
      ...(o as T.InstancedMesh).instanceMatrix.array,
    ]);
    effects.update(0, camera);
    expect(
      scene.children.map((o) => [
        ...(o as T.InstancedMesh).instanceMatrix.array,
      ]),
    ).toEqual(held);
    effects.update(3, camera);
    expect(effects.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    effects.burst("deploy:giant", new T.Vector3(), 42, "blue", 1.5);
    effects.update(0, camera);
    expect(
      Object.keys(effects.activeClips).every((c) => c.startsWith("Rock")),
    ).toBe(true);
    expect(effects.count).toBeGreaterThan(0);
    effects.clear();
    library.destroy();
  });
});
