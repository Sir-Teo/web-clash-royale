import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { electroExtraTarget } from "../src/game/electro-bolts";
import { createKingDefense } from "../src/game/king-defense";
import { fatalKingWindups } from "../src/game/king-spell-race";
import { perspective, snapshot } from "../src/network/perspective";
import native from "../reference/client/electro-bolts-native-trace.json";
import historical from "./fixtures/electro-bolts-rules26-golden.json";

const cards: Record<string, CardId> = {
  Knight: "knight",
  Giant: "giant",
  Balloon: "balloon",
};
function scene(version: 26 | 27 = 27, team: Team = "blue") {
  const initial = new Battle({ seed: 2721, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of battle.entities)
    Object.assign(entity, { active: false, x: 40, y: 40 });
  const spawn = (card: CardId, owner: Team) => {
    (battle as any).spawn(card, owner, 8, 20);
    const entity = battle.entities.at(-1)!;
    Object.assign(entity, {
      deploy: 0,
      age: 3,
      active: false,
      hp: 100000,
      maxHp: 100000,
    });
    return entity;
  };
  const wizard = spawn("electro-wizard", team);
  Object.assign(wizard, { active: true, cooldown: 1000 });
  const enemy = team === "blue" ? "red" : "blue";
  const primary = spawn("knight", enemy);
  Object.assign(primary, { x: 8, y: team === "blue" ? 18.5 : 21.5 });
  return { battle, wizard, primary, spawn, enemy };
}

it.each(native.cases.filter((row) => row.allTargetsHit))(
  "matches executed native extra-hit dispatch: $case / $teamIndex / $addOwnRadius / $sourceControl",
  (row) => {
    const team = row.teamIndex === 0 ? "red" : "blue";
    const { battle, wizard, primary, spawn, enemy } = scene(27, team);
    Object.assign(wizard, {
      x: 0,
      y: 0,
      rangeRadiusFactor: Number(row.addOwnRadius),
      sightRange: 5.5 + (row.addOwnRadius ? 0.5 : 0),
    });
    const ids = new Map<number, string>();
    const selected: Entity[] = [];
    let lock = primary;
    for (const point of row.candidates) {
      const entity =
        point.id === "primary"
          ? primary
          : point.name === "KingTower" || point.name === "PrincessTower"
            ? battle.entities.find(
                (body) =>
                  body.team === enemy &&
                  body.kind === "tower" &&
                  !!body.king === (point.name === "KingTower"),
              )!
            : spawn(cards[point.name], enemy);
      Object.assign(entity, {
        x: point.x / 1000,
        y: point.y / 1000,
        hp: point.eligible === false ? 0 : 100000,
      });
      ids.set(entity.id, point.id);
      selected.push(entity);
      if (point.id === "primary") lock = entity;
    }
    // Selection happens after the first packet; the native clear control has
    // supplied false eligibility for the primary at that boundary.
    const extra = electroExtraTarget(wizard, lock, selected);
    expect(extra && ids.get(extra.id)).toBe(
      row.dispatches.find((hit) => hit.index === 1)?.target,
    );
  },
);

function release(battle: Battle, wizard: Entity, primary: Entity, frames = 1) {
  wizard.target = primary.id;
  wizard.pendingAttack = {
    target: primary.id,
    remaining: STEP * frames,
    damage: wizard.damage,
  };
}
const hits = (battle: Battle) =>
  battle.events.filter(
    (event) => event.type === "hit" && event.card === "electro-wizard",
  );

it.each(["blue", "red"] as const)(
  "concentrates both real packets and preserves the earlier lone hit (%s)",
  (team) => {
    for (const version of [26, 27] as const) {
      const { battle, wizard, primary } = scene(version, team);
      release(battle, wizard, primary);
      battle.step();
      expect(primary.hp).toBe(
        100000 - wizard.damage * (version === 27 ? 2 : 1),
      );
      expect(hits(battle)).toHaveLength(version === 27 ? 2 : 1);
      expect(new Set(hits(battle).map((hit) => hit.time)).size).toBe(1);
      expect(primary.stun).toBeGreaterThan(0);
    }
  },
);

it("splits one packet per surviving enemy and keeps source per-bolt damage", () => {
  const { battle, wizard, primary, spawn, enemy } = scene();
  const other = spawn("giant", enemy);
  Object.assign(other, { x: 10.5, y: 20 });
  release(battle, wizard, primary);
  battle.step();
  expect([primary.hp, other.hp]).toEqual([
    100000 - wizard.damage,
    100000 - wizard.damage,
  ]);
  expect(hits(battle).map((hit) => hit.value)).toEqual([121, 121]);
});

it("breaks a shield with the first packet and damages the body with the second", () => {
  const { battle, wizard, primary } = scene();
  primary.shield = primary.maxShield = 60;
  release(battle, wizard, primary);
  battle.step();
  expect(primary.shield).toBe(0);
  expect(primary.hp).toBe(100000 - wizard.damage);
  expect(hits(battle)).toHaveLength(2);
});

it("does not emit a second hit against a primary killed by the first packet", () => {
  const { battle, wizard, primary } = scene();
  primary.hp = 1;
  release(battle, wizard, primary);
  battle.step();
  expect(primary.hp).toBe(0);
  expect(hits(battle)).toHaveLength(1);
});

it("scans actual death-spawned children after the primary packet", () => {
  const { battle, wizard, primary, spawn, enemy } = scene();
  primary.hp = 0;
  const tombstone = spawn("tombstone", enemy);
  Object.assign(tombstone, { x: 8, y: 18.5, hp: 1 });
  release(battle, wizard, tombstone);
  battle.step();
  expect(hits(battle)).toHaveLength(2);
  expect(
    hits(battle)[1].x !== tombstone.x || hits(battle)[1].y !== tombstone.y,
  ).toBe(true);
  expect(
    battle.events.some(
      (event) => event.type === "death" && event.card === "skeletons",
    ),
  ).toBe(true);
});

it("retains bolt policy on a real Clone and uses the clone's own damage", () => {
  const { battle, wizard, primary } = scene();
  battle.players.blue.hand[0] = "clone";
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, wizard.x, wizard.y).ok).toBe(true);
  battle.step();
  const copy = battle.entities.find(
    (entity) => entity.card === "electro-wizard" && entity.clone,
  )!;
  expect(copy.nativeExtraTargets).toBe(true);
  wizard.active = false;
  Object.assign(copy, { deploy: 0, age: 3, cooldown: 1000 });
  release(battle, copy, primary);
  battle.step();
  expect(primary.hp).toBe(100000 - 2 * copy.damage);
});

it("preserves the policy and selected victim across red-side snapshots", () => {
  const { battle, wizard, primary, spawn, enemy } = scene();
  const other = spawn("giant", enemy);
  Object.assign(other, { x: 10.5, y: 20 });
  for (const team of ["blue", "red"] as const) {
    const view = perspective(snapshot(battle), team);
    const actor = view.entities.find((entity) => entity.id === wizard.id)!;
    const lock = view.entities.find((entity) => entity.id === primary.id)!;
    expect(actor.nativeExtraTargets).toBe(true);
    expect(electroExtraTarget(actor, lock, view.entities)?.id).toBe(other.id);
  }
});

it("omits the new field throughout earlier origin recordings", () => {
  const initial = new Battle({ seed: 2722, ai: false });
  for (let version = 1; version <= 26; version++) {
    const battle = new Battle({
      replay: { ...initial.exportReplay(), version } as Replay,
    });
    (battle as any).spawn("electro-wizard", "blue", 8, 20);
    expect(battle.entities.at(-1)).not.toHaveProperty("nativeExtraTargets");
  }
});

it.each(["blue", "red"] as const)(
  "King defense agrees with a concentrated fatal windup and Freeze rescue (%s)",
  (team) => {
    const { battle, wizard, primary, enemy } = scene(27, team);
    primary.hp = 0;
    const king = battle.entities.find(
      (entity) => entity.team === enemy && entity.king,
    )!;
    Object.assign(king, {
      x: wizard.x,
      y: wizard.y + (team === "blue" ? -1.5 : 1.5),
      hp: 200,
    });
    release(battle, wizard, king, 6);
    const before = JSON.stringify(battle.entities);
    const defense = createKingDefense(enemy, battle.entities);
    expect(defense.baseline).toBe(6);
    expect(fatalKingWindups(enemy, battle.entities)[0].step).toBe(6);
    expect(defense.evaluate("freeze", wizard).improves).toBe(true);
    expect(JSON.stringify(battle.entities)).toBe(before);
    battle.players[enemy].hand[0] = "freeze";
    battle.players[enemy].elixir = 10;
    expect(battle.play(enemy, 0, wizard.x, wizard.y).ok).toBe(true);
    for (let step = 0; step < 10; step++) battle.step();
    expect(king.hp).toBe(200);
  },
);

it("counts a King reached by the secondary packet while the primary lock is a troop", () => {
  const { battle, wizard, primary, enemy } = scene();
  const king = battle.entities.find(
    (entity) => entity.team === enemy && entity.king,
  )!;
  Object.assign(king, { x: 8, y: 17, hp: 100 });
  release(battle, wizard, primary);
  expect(createKingDefense(enemy, battle.entities).baseline).toBe(1);
  expect(fatalKingWindups(enemy, battle.entities)[0].step).toBe(1);
  battle.step();
  expect(king.hp).toBe(0);
  expect(battle.winner).toBe("blue");
});

it("rejects a Tornado that creates a fatal secondary King hit without changing release time", () => {
  const { battle, wizard, primary, enemy } = scene();
  const king = battle.entities.find(
    (entity) => entity.team === enemy && entity.king,
  )!;
  Object.assign(king, { x: 8, y: 13.05, hp: 100 });
  release(battle, wizard, primary, 15);
  const defense = createKingDefense(enemy, battle.entities);
  expect(defense.baseline).toBe(Infinity);
  const point = { x: 8, y: 16.5 };
  const projected = defense.evaluate("tornado", point);
  expect(projected.worsens).toBe(true);
  battle.players[enemy].hand[0] = "tornado";
  battle.players[enemy].elixir = 10;
  expect(battle.play(enemy, 0, point.x, point.y).ok).toBe(true);
  while (!battle.winner && battle.tick <= 20) battle.step();
  expect(king.hp).toBe(0);
  expect(battle.tick).toBe(projected.deathStep);
});

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
it("preserves complete pinned rules-26 games with Clone, Mirror, Graveyard and historical AI", () => {
  expect(historical.sourceCommit).toBe("c49139a");
  for (const row of historical.cases) {
    expect(row.electroHits).toBeGreaterThan(0);
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

it("records and replays a complete current dual-bolt game with identical world and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 27, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  let strikes = 0;
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (entry) => entry.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    strikes = Math.max(strikes, ...hits(live).map((hit) => hit.id), 0);
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  expect(strikes).toBeGreaterThan(0);
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(27);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
