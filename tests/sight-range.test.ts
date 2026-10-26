import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { CARDS, type CardId } from "../src/game/cards";
import { combatTraits } from "../src/game/combat";
import { acquisitionSight, nativeSightRange } from "../src/game/sight-range";
import { perspective, snapshot } from "../src/network/perspective";
import combat from "../src/game/combat-data.json";
import native from "../reference/client/sight-range-native-trace.json";
import historical from "./fixtures/sight-range-rules24-golden.json";

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

it("pins sight evidence alongside the shared archived radius setting", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/attack-range-manifest.json", "utf8"),
  );
  expect(
    manifest.inputs.some(
      (input: { path: string }) =>
        input.path === "reference/client/sight-range-native-trace.json",
    ),
  ).toBe(true);
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
});

it.each(native.profiles)(
  "matches native resolved sight and plain candidate bounds for $name",
  (profile) => {
    const id = Object.entries(combat).find(
      ([, value]) => value.source === profile.name,
    )![0];
    const actor = {
      card: (id.endsWith("-tower") &&
      ["king-tower", "princess-tower"].includes(id)
        ? "tower"
        : id) as CardId | "tower",
      king: id === "king-tower",
      radius: profile.CollisionRadius / 1000,
      range: 0,
    };
    expect(combatTraits(actor).sight * 1000).toBe(profile.SightRange);
    for (const getter of profile.getters)
      expect(
        nativeSightRange(actor, Number(getter.addOwnRadius)) * 1000,
      ).toBeCloseTo(getter.sightRange, 8);
    for (const point of profile.samples.filter(
      (sample) => sample.classFlags === "plain",
    )) {
      const sightRange = nativeSightRange(actor, Number(point.addOwnRadius));
      const reach =
        acquisitionSight({ ...actor, sightRange }) + point.targetRadius / 1000;
      expect(Math.round(reach * 1000) ** 2 >= point.x ** 2).toBe(
        point.passesSightGate,
      );
    }
  },
);

it("resolves every current troop, building, child and Crown Tower from source sight and body radius", () => {
  const battle = new Battle({ seed: 129, ai: false });
  for (const card of [
    ...CARDS.filter((entry) => entry.kind !== "spell").map((entry) => entry.id),
    "golemite",
    "lava-pup",
  ] as CardId[])
    (battle as any).spawn(card, "blue", 9, 22, false);
  for (const entity of battle.entities)
    expect(entity.sightRange, entity.card).toBe(
      combatTraits(entity).sight + entity.radius,
    );
});

function scene(
  card:
    "knight" | "cannon" | "musketeer" | "inferno-tower" | "king" | "princess",
  team: Team,
  version: 24 | 25,
) {
  const initial = new Battle({ seed: 591, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of battle.entities)
    Object.assign(entity, { active: false, x: 30, y: 30 });
  let attacker: Entity;
  if (card === "king" || card === "princess")
    attacker = battle.entities.find(
      (entry) => entry.team === team && !!entry.king === (card === "king"),
    )!;
  else {
    (battle as any).spawn(card, team, 0, 0);
    attacker = battle.entities.at(-1)!;
  }
  Object.assign(attacker, {
    active: true,
    deploy: 0,
    cooldown: 0,
    speed: 0,
    target: null,
    x: 0,
    y: 0,
  });
  (battle as any).spawn("knight", team === "blue" ? "red" : "blue", 0, 0);
  const target = battle.entities.at(-1)!;
  Object.assign(target, { active: false, deploy: 0, hp: 1e6, maxHp: 1e6 });
  return { battle, attacker, target };
}

describe.each(["blue", "red"] as const)("new-target sight (%s)", (team) => {
  it.each([
    "cannon",
    "musketeer",
    "inferno-tower",
    "king",
    "princess",
  ] as const)(
    "%s notices a new troop at native sight equality but not one source unit outside",
    (card) => {
      for (const version of [24, 25] as const)
        for (const offset of [0, 0.001]) {
          const { battle, attacker, target } = scene(card, team, version);
          target.x = nativeSightRange(attacker) + target.radius + offset;
          expect(attacker.target).toBeNull();
          battle.step();
          const discovers = version === 25 && offset === 0;
          expect(
            attacker.target === target.id,
            `${card}:${version}:${offset}`,
          ).toBe(discovers);
          expect(!!(attacker.pendingAttack || attacker.inferno)).toBe(
            discovers,
          );
        }
    },
  );
});

it("notices a defender outside the old sight bound before starting a melee attack", () => {
  for (const version of [24, 25] as const) {
    const { battle, attacker, target } = scene("knight", "blue", version);
    attacker.target = battle.entities.find(
      (entity) => entity.team === "red" && entity.king,
    )!.id;
    target.x =
      combatTraits(attacker).sight + target.radius + attacker.radius / 2;
    battle.step();
    expect(attacker.target === target.id).toBe(version === 25);
    expect(attacker.pendingAttack).toBeUndefined();
  }
});

it("keeps the original sight expression and omits new snapshot fields for versions 1–24", () => {
  const initial = new Battle({ seed: 592, ai: false });
  for (let version = 1; version <= 24; version++) {
    const battle = new Battle({
      replay: {
        ...initial.exportReplay(),
        version: version as Replay["version"],
      },
    });
    (battle as any).spawn("knight", "blue", 9, 22, false);
    for (const entity of battle.entities) {
      expect(entity).not.toHaveProperty("sightRange");
      expect(acquisitionSight(entity)).toBe(
        Math.max(combatTraits(entity).sight, entity.range),
      );
    }
  }
});

it("preserves resolved sight through peer snapshots and red-side projection", () => {
  const { battle, attacker } = scene("cannon", "blue", 25);
  for (const team of ["blue", "red"] as const) {
    const projected = perspective(snapshot(battle), team).entities.find(
      (entry) => entry.id === attacker.id,
    )!;
    expect(projected.sightRange).toBe(attacker.sightRange);
    expect(acquisitionSight(projected)).toBe(acquisitionSight(attacker));
  }
});

it("preserves independently captured complete rules-24 games, Graveyard and historical AI", () => {
  expect(historical.sourceCommit).toBe("42fe948");
  expect(historical.cases.some((row) => row.ai)).toBe(true);
  expect(
    historical.cases.some((row) => row.deployed.includes("graveyard")),
  ).toBe(true);
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

it("records and replays a complete rules-25 game with identical world and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 25, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter(
      (entry) => entry.tick === live.tick,
    )) {
      const team = action.team as Team,
        slot = live.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) live.play(team, slot, action.x, action.y);
    }
    live.step();
    if (live.tick % 300 === 0 || live.winner)
      checkpoints.push({ tick: live.tick, digest: digest(live) });
  }
  expect(live.winner).toBeTruthy();
  const replay = new Battle({ replay: live.exportReplay() });
  expect(replay.rulesVersion).toBe(25);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
