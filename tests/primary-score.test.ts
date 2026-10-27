import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import {
  comparePrimaryTargets,
  primaryTargetScore,
} from "../src/game/primary-score";
import { buildingLureTarget } from "../src/game/building-lure";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { perspective, snapshot } from "../src/network/perspective";
import historical from "./fixtures/primary-score-rules28-golden.json";

const primary = JSON.parse(
  readFileSync(
    "reference/client/primary-acquisition-native-trace.json",
    "utf8",
  ),
);
const spawned = JSON.parse(
  readFileSync("reference/client/spawn-priority-native-trace.json", "utf8"),
);
const owners = [
  ...new Set<string>(primary.cases.map((sample: any) => sample.owner)),
];
const origins = [
  { x: 0, y: 0 },
  { x: 8, y: 20 },
  { x: 17.25, y: 30.875 },
];
const nearest = (origin: { x: number; y: number }, points: any[]) => {
  const actor = { ...origin, nativePrimaryScore: true as const };
  const targets = points.map((point) => ({
    id: point.id,
    x: origin.x + point.x / 1000,
    y: origin.y + point.y / 1000,
    radius: point.name === "Giant" ? 1 : 0.5,
    targetScoreBias: point.fieldAC ?? 0,
  }));
  return targets.reduce((best, target) =>
    comparePrimaryTargets(actor, target, best) < 0 ? target : best,
  ).id;
};

it("pins native score, ordinal and imported source/output hashes", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/primary-score-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(primary.sha256);
  expect(spawned.sha256).toBe(primary.sha256);
});
it.each(owners)(
  "matches native center, adjusted-score and exact tie controls for %s at three origins",
  (owner) => {
    const samples = primary.cases.filter(
      (sample: any) =>
        sample.owner === owner &&
        [
          "center-over-edge",
          "stable-score-tie",
          "positive-field-adjustment",
          "negative-field-adjustment",
        ].includes(sample.case),
    );
    expect(samples).toHaveLength(32);
    for (const sample of samples)
      for (const origin of origins)
        expect(
          nearest(origin, sample.candidates),
          `${sample.case}:${sample.teamIndex}`,
        ).toBe(sample.nominated);
  },
);
it.each(owners)(
  "matches native Barrel-adjusted ranking for every eligible %s control at three origins",
  (owner) => {
    const samples = spawned.cases.filter(
      (sample: any) => sample.owner === owner && sample.nominated !== null,
    );
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples)
      for (const origin of origins)
        expect(
          nearest(origin, sample.candidates),
          `${sample.case}:${sample.spawnConstPriority}:${sample.reverseCollection}`,
        ).toBe(sample.nominated);
  },
);

function make(version: 28 | 29 = 29) {
  const initial = new Battle({ seed: 2901, ai: false });
  const match = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const entity of match.entities) entity.active = false;
  return match;
}
function spawn(match: Battle, card: CardId, team: Team, x: number, y: number) {
  (match as any).spawn(card, team, x, y);
  const entity = match.entities.at(-1)!;
  Object.assign(entity, {
    deploy: 0,
    age: 3,
    speed: 0,
    active: false,
    hp: 1e6,
    maxHp: 1e6,
  });
  return entity;
}
for (const version of [28, 29] as const)
  it.each(["blue", "red"] as const)(
    `selects the expected nearby body in real rules-${version} combat (%s)`,
    (team) => {
      const match = make(version),
        enemy = team === "blue" ? "red" : "blue",
        y = team === "blue" ? 20 : 12;
      const actor = spawn(match, "knight", team, 8, y);
      Object.assign(actor, { active: true, cooldown: 1000 });
      const closer = spawn(match, "knight", enemy, 10.1, y);
      const larger = spawn(
        match,
        "giant",
        enemy,
        8,
        y + (team === "blue" ? -2.2 : 2.2),
      );
      match.step();
      expect(actor.target).toBe(version === 29 ? closer.id : larger.id);
      actor.target = larger.id;
      match.step();
      expect(actor.target).toBe(larger.id);
    },
  );

function barrel(version: 28 | 29, team: Team) {
  const match = make(version);
  match.players[team].hand[0] = "goblin-barrel";
  match.players[team].elixir = 10;
  expect(match.play(team, 0, 9, 16).ok).toBe(true);
  for (
    let tick = 0;
    tick < 240 &&
    match.projectiles.some((shot) => shot.style === "goblin-barrel");
    tick++
  )
    match.step();
  const goblins = match.entities.filter((entity) => entity.card === "goblins");
  expect(goblins).toHaveLength(3);
  for (const [index, child] of goblins.entries())
    Object.assign(child, {
      x: index === 0 ? 7 : index === 1 ? 9 : 11,
      y: index === 1 ? 18 : 20,
      active: false,
      deploy: 0,
      hp: 1e6,
      maxHp: 1e6,
    });
  return { match, goblins };
}
for (const version of [28, 29] as const)
  for (const reverse of [false, true])
    it.each(["blue", "red"] as const)(
      `assigns and uses actual Barrel priorities in rules ${version}, reverse ${reverse} (%s)`,
      (team) => {
        const { match, goblins } = barrel(version, team);
        expect(goblins.map((child) => child.targetScoreBias)).toEqual(
          version === 29 ? [0, 400, 1600] : [undefined, undefined, undefined],
        );
        const enemy = team === "blue" ? "red" : "blue";
        const actor = spawn(match, "cannon", enemy, 9, 20);
        Object.assign(actor, { active: true, cooldown: 1000 });
        if (reverse)
          match.entities = [
            ...match.entities.filter((body) => !goblins.includes(body)),
            ...goblins.toReversed(),
          ];
        match.step();
        expect(actor.target).toBe(
          goblins[version === 29 || reverse ? 2 : 0].id,
        );
      },
    );

it("retains source bias on guests, resets it on new Clones and starts each mirrored Barrel's ordinal afresh", () => {
  const { match, goblins } = barrel(29, "blue");
  for (const team of ["blue", "red"] as const)
    expect(
      perspective(snapshot(match), team)
        .entities.filter((body) =>
          goblins.some((goblin) => goblin.id === body.id),
        )
        .map((body) => body.targetScoreBias),
    ).toEqual([0, 400, 1600]);
  match.players.blue.hand[0] = "mirror";
  match.players.blue.elixir = 10;
  expect(match.play("blue", 0, 9, 16).ok).toBe(true);
  for (
    let tick = 0;
    tick < 240 &&
    match.projectiles.some((shot) => shot.style === "goblin-barrel");
    tick++
  )
    match.step();
  const mirrored = match.entities.filter(
    (body) => body.card === "goblins" && !goblins.includes(body),
  );
  expect(mirrored.map((body) => body.targetScoreBias)).toEqual([0, 400, 1600]);
  for (const body of mirrored)
    Object.assign(body, { active: false, deploy: 0 });
  match.players.blue.hand[0] = "clone";
  match.players.blue.elixir = 10;
  expect(match.play("blue", 0, goblins[2].x, goblins[2].y).ok).toBe(true);
  match.step();
  const copies = match.entities.filter((body) => body.clone);
  expect(copies.length).toBeGreaterThan(0);
  expect(
    copies.every(
      (body) =>
        body.nativePrimaryScore && !Object.hasOwn(body, "targetScoreBias"),
    ),
  ).toBe(true);
});

it("keeps ordinary Goblins and earlier bodies free of Barrel-specific fields", () => {
  for (let version = 1; version <= 28; version++) {
    const initial = new Battle({ seed: 12, ai: false });
    const match = new Battle({
      replay: {
        ...initial.exportReplay(),
        version: version as Replay["version"],
      },
    });
    spawn(match, "goblins", "blue", 8, 20);
    expect(
      match.entities.every(
        (body) =>
          !Object.hasOwn(body, "nativePrimaryScore") &&
          !Object.hasOwn(body, "targetScoreBias"),
      ),
    ).toBe(true);
  }
  const match = make();
  const ordinary = spawn(match, "goblins", "blue", 8, 20);
  expect(ordinary.nativePrimaryScore).toBe(true);
  expect(Object.hasOwn(ordinary, "targetScoreBias")).toBe(false);
  expect(
    primaryTargetScore(
      { x: 0, y: 0 },
      { x: 3, y: 4, radius: 1, targetScoreBias: 99999999 },
    ),
  ).toBe(4);
});

it.each([28, 29] as const)(
  "preserves distant edge-based destinations under rules %s",
  (version) => {
    const match = make(version);
    for (const body of match.entities) Object.assign(body, { x: 40, y: 40 });
    const king = match.entities.find(
      (body) => body.team === "red" && body.king,
    )!;
    Object.assign(king, { x: 8, y: 4.5, radius: 1.4 });
    const actor = spawn(match, "knight", "blue", 8, 28);
    Object.assign(actor, { active: true, cooldown: 1000 });
    spawn(match, "cannon", "red", 8, 5);
    match.step();
    expect(actor.target).toBe(king.id);
  },
);

it.each([28, 29] as const)(
  "keeps building lures and melee leads aligned with actual rules-%s acquisition",
  (version) => {
    const match = make(version);
    const balloon = spawn(match, "balloon", "red", 9, 25.5);
    const before = JSON.stringify(snapshot(match));
    const point = buildingLureTarget(
      "cannon",
      "blue",
      balloon,
      match.entities,
      (point) => point.x === 9 && point.y === 22,
    );
    expect(point).toEqual(version === 29 ? { x: 9, y: 22 } : undefined);
    expect(JSON.stringify(snapshot(match))).toBe(before);
    match.players.blue.hand[0] = "cannon";
    match.players.blue.elixir = 10;
    expect(match.play("blue", 0, 9, 22).ok).toBe(true);
    const cannon = match.entities.at(-1)!;
    const king = match.entities.find(
      (body) => body.team === "blue" && body.king,
    )!;
    Object.assign(balloon, { active: true, cooldown: 1000 });
    match.step();
    expect(balloon.target).toBe(version === 29 ? cannon.id : king.id);
    balloon.active = false;
    const giant = spawn(match, "giant", "red", 9, 25.5);
    giant.active = true;
    giant.speed = CARD_MAP.giant.speed;
    const lead = meleeInterceptTarget(
      "knight",
      "blue",
      giant,
      match.entities,
      () => true,
    );
    expect(lead).toBeDefined();
    expect(version === 29 ? lead!.y < giant.y : lead!.y > giant.y).toBe(true);
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
it("preserves complete rules-28 matches with Barrel landings, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("01037af");
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
    replay: { ...old, version: 29, actions: [], duration: 12000 } as Replay,
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
  expect(replay.rulesVersion).toBe(29);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
