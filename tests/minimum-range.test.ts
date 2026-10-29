import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { minimumAttackDistance } from "../src/game/attack-range";
import { placementRanges } from "../src/render/placement-ranges";
import { createKingDefense } from "../src/game/king-defense";
import { fatalKingWindups } from "./helpers/fatal-king-windups";
import { perspective, snapshot } from "../src/network/perspective";
import native from "../reference/client/attack-minimum-native-trace.json";
import scanned from "../reference/client/candidate-minimum-native-trace.json";
import radii from "../src/game/archived-collision-radii.json";
import mortar from "../src/game/mortar-data.json";
import historical from "./fixtures/minimum-range-rules25-golden.json";

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

it("pins both native minimum gates, source settings, Mortar data and roster radii", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/attack-range-manifest.json", "utf8"),
  );
  for (const path of [
    "reference/client/attack-minimum-native-trace.json",
    "reference/client/candidate-minimum-native-trace.json",
    "src/game/mortar-data.json",
    "src/game/archived-collision-radii.json",
  ])
    expect(
      manifest.inputs.some((entry: { path: string }) => entry.path === path),
    ).toBe(true);
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(native.sha256).toBe(scanned.sha256);
  expect(native.addCharacterRangeToRadius).toBe(true);
});

it.each(native.profiles)(
  "matches every captured attack minimum boundary for $name",
  (profile) => {
    for (const point of profile.samples) {
      const inner = minimumAttackDistance(
        {
          radius: profile.CollisionRadius / 1000,
          rangeRadiusFactor: Number(point.addOwnRadius),
          minimumRange: profile.MinimumRange / 1000,
        },
        { radius: point.targetRadius / 1000 },
      );
      expect(point.x ** 2 + point.y ** 2 >= Math.round(inner * 1000) ** 2).toBe(
        point.inRange,
      );
    }
  },
);

it("matches native candidate minimums throughout the enabled roster-sized domain", () => {
  const largest =
    Math.max(...Object.values(radii.cards), ...Object.values(radii.towers)) *
    1000;
  expect(largest).toBe(1400);
  for (const profile of scanned.profiles)
    for (const point of profile.samples.filter(
      (entry) => entry.addOwnRadius && entry.targetRadius <= largest,
    )) {
      const inner = minimumAttackDistance(
        {
          radius: profile.CollisionRadius / 1000,
          rangeRadiusFactor: 1,
          minimumRange: profile.MinimumRange / 1000,
        },
        { radius: point.targetRadius / 1000 },
      );
      expect(Math.abs(point.x) >= Math.round(inner * 1000)).toBe(
        point.passesCandidateGates,
      );
    }
});

type Victim = "knight" | "giant" | "goblin-hut" | "princess" | "king";
function scene(victim: Victim, team: Team, version: 25 | 26) {
  const initial = new Battle({ seed: 826, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of battle.entities)
    Object.assign(entity, { active: false, x: 30, y: 30 });
  (battle as any).spawn("mortar", team, 0, 0);
  const attacker = battle.entities.at(-1)!;
  Object.assign(attacker, {
    active: true,
    deploy: 0,
    cooldown: 0,
    target: null,
  });
  const enemy = team === "blue" ? "red" : "blue";
  let target: Entity;
  if (victim === "king" || victim === "princess")
    target = battle.entities.find(
      (entry) => entry.team === enemy && !!entry.king === (victim === "king"),
    )!;
  else {
    (battle as any).spawn(victim, enemy, 0, 0);
    target = battle.entities.at(-1)!;
  }
  Object.assign(target, {
    x: 0,
    y: 0,
    active: false,
    deploy: 0,
    hp: 1e6,
    maxHp: 1e6,
    lifetime: undefined,
  });
  return { battle, attacker, target, enemy };
}

describe.each(["blue", "red"] as const)("live Mortar minimum (%s)", (team) => {
  it.each(["knight", "giant", "goblin-hut", "princess", "king"] as const)(
    "accepts native equality for %s and preserves the old center bound",
    (victim) => {
      for (const version of [25, 26] as const)
        for (const offset of [-0.001, 0, 0.001]) {
          const { battle, attacker, target } = scene(victim, team, version);
          target.x =
            mortar.minimumRange + attacker.radius - target.radius + offset;
          battle.step();
          const expected =
            version === 26 ? offset >= 0 : target.x >= mortar.minimumRange;
          expect(
            !!attacker.pendingAttack,
            `${victim}:${version}:${offset}`,
          ).toBe(expected);
          if (expected) expect(attacker.pendingAttack?.target).toBe(target.id);
          expect(attacker.minimumRange).toBe(
            version === 26 ? mortar.minimumRange : undefined,
          );
        }
    },
  );
});

it("cancels a real windup when a small target crosses the new inner boundary", () => {
  for (const version of [25, 26] as const) {
    const { battle, attacker, target } = scene("knight", "blue", version);
    target.x = mortar.minimumRange + attacker.radius - target.radius + 0.01;
    battle.step();
    expect(attacker.pendingAttack).toBeDefined();
    target.x -= 0.02;
    battle.step();
    expect(!!attacker.pendingAttack).toBe(version === 25);
    expect(battle.projectiles.some((shot) => shot.source === attacker.id)).toBe(
      false,
    );
  }
});

it.each(["blue", "red"] as const)(
  "King forecasts agree with actual inner-bound cancellation and a legal close shot (%s)",
  (team) => {
    for (const offset of [-0.01, 0.01]) {
      const { battle, attacker, target, enemy } = scene("king", team, 26);
      target.hp = 100;
      target.x = minimumAttackDistance(attacker, target) + offset;
      attacker.target = target.id;
      attacker.cooldown = 1000;
      attacker.pendingAttack = {
        target: target.id,
        remaining: 1 / 30,
        damage: attacker.damage,
      };
      const forecast = createKingDefense(enemy, battle.entities).baseline;
      expect(fatalKingWindups(enemy, battle.entities).length).toBe(
        offset > 0 ? 1 : 0,
      );
      let actual = Infinity;
      for (let step = 1; step <= 60 && !battle.winner; step++) {
        battle.step();
        if (battle.winner) actual = step;
      }
      expect(forecast).toBe(actual);
      expect(Number.isFinite(actual)).toBe(offset > 0);
    }
  },
);

it("preserves inner-range metadata through snapshots and red-side projection", () => {
  const { battle, attacker, target } = scene("king", "blue", 26);
  for (const team of ["blue", "red"] as const) {
    const view = perspective(snapshot(battle), team);
    const source = view.entities.find((entry) => entry.id === attacker.id)!;
    const victim = view.entities.find((entry) => entry.id === target.id)!;
    expect(source.minimumRange).toBe(4.5);
    expect(minimumAttackDistance(source, victim)).toBe(
      minimumAttackDistance(attacker, target),
    );
  }
});

it("omits the new inner-range field for all earlier origin rules", () => {
  const initial = new Battle({ seed: 827, ai: false });
  for (let version = 1; version <= 25; version++) {
    const battle = new Battle({
      replay: {
        ...initial.exportReplay(),
        version: version as Replay["version"],
      },
    });
    (battle as any).spawn("mortar", "blue", 9, 22);
    expect(battle.entities.at(-1)).not.toHaveProperty("minimumRange");
    expect(
      minimumAttackDistance(
        battle.entities.at(-1)!,
        { radius: 1.4 },
        mortar.minimumRange,
      ),
    ).toBe(4.5);
  }
});

it("draws matching zero-target inner/outer preview bounds and retains spell/troop previews", () => {
  expect(placementRanges("mortar", 23)).toEqual({ outer: 11.5, inner: 4.5 });
  expect(placementRanges("mortar", 25)).toEqual({ outer: 12.1, inner: 4.5 });
  expect(placementRanges("mortar", 26)).toEqual({ outer: 12.1, inner: 5.1 });
  expect(placementRanges("cannon", 26)).toEqual({ outer: 6.1, inner: 0 });
  expect(placementRanges("inferno-tower", 26)).toEqual({
    outer: 6.6,
    inner: 0,
  });
  expect(placementRanges("elixir-collector", 26)).toEqual({
    outer: 0,
    inner: 0,
  });
  expect(placementRanges("fireball", 26)).toEqual(
    placementRanges("fireball", 23),
  );
  expect(placementRanges("knight", 26)).toEqual({ outer: 0.8, inner: 0 });
});

it("preserves complete independently captured rules-25 games, including Mortar and historical AI", () => {
  expect(historical.sourceCommit).toBe("79b3ca6");
  expect(historical.cases[0].mortarShots).toBeGreaterThan(0);
  expect(historical.cases.some((row) => row.ai)).toBe(true);
  expect(historical.cases.some((row) => row.deployed.includes("mortar"))).toBe(
    true,
  );
  for (const row of historical.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (battle as any).ai = true;
      (battle as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (entry) => entry.team === "blue" && entry.tick === battle.tick,
          )) {
            const slot = battle.players.blue.hand.indexOf(
              action.card as CardId,
            );
            expect(battle.play("blue", slot, action.x, action.y).ok).toBe(true);
          }
        battle.step();
      }
      expect(digest(battle), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
    expect(battle.winner).toBeTruthy();
  }
});

it("records and replays a complete current Mortar game with identical world and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 26, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  const shots = new Set<number>();
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (entry) => entry.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    for (const shot of live.projectiles)
      if (shot.style === "mortar") shots.add(shot.id);
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(live.actions.some((entry) => entry.card === "mortar")).toBe(true);
  expect(shots.size).toBeGreaterThan(0);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(26);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
