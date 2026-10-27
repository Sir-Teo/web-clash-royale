import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Battle, type Replay, type Team } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import { primaryCandidateVisible } from "../src/game/primary-geometry";
import { buildingLureTarget } from "../src/game/building-lure";
import { meleeInterceptTarget } from "../src/game/melee-intercept";
import { CARD_MAP } from "../src/game/cards";
import { snapshot, perspective } from "../src/network/perspective";
import historical from "./fixtures/primary-geometry-rules29-golden.json";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const native = read("reference/client/primary-geometry-native-trace.json");
const types = read("reference/client/sight-target-types-native-trace.json");
const cards: Record<string, CardId | "tower"> = {
  Knight: "knight",
  Archer: "archers",
  Musketeer: "musketeer",
  Giant: "giant",
  HogRider: "hog-rider",
  Balloon: "balloon",
  Prince: "prince",
  InfernoDragon: "inferno-dragon",
  Cannon: "cannon",
  Mortar: "mortar",
  InfernoTower: "inferno-tower",
  KingTower: "tower",
  PrincessTower: "tower",
};
const origins = [
  { x: 0, y: 0 },
  { x: 8, y: 20 },
  { x: 17.25, y: 30.875 },
];
it("pins the native geometry capture and every imported source/output hash", () => {
  const manifest = read("reference/client/primary-geometry-manifest.json");
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(native.cases).toHaveLength(8112);
  expect(native.controls).toHaveLength(3692);
});
for (const group of ["cases", "controls"])
  it.each(Object.keys(cards))(
    `matches native ${group} for %s at three translated origins`,
    (owner) => {
      const profile = types.profiles.find((row: any) => row.name === owner);
      const samples = native[group].filter(
        (row: any) => row.owner === owner && row.eligible,
      );
      expect(samples.length).toBeGreaterThan(0);
      for (const sample of samples)
        for (const origin of origins) {
          const viewer = {
            ...origin,
            card: cards[owner],
            king: owner === "KingTower",
            team: (sample.teamIndex === 0 ? "red" : "blue") as Team,
            radius: profile.CollisionRadius / 1000,
            range: 0,
            rangeRadiusFactor: sample.addOwnRadius ? 1 : 0,
            minimumRange: profile.MinimumRange / 1000,
            sightRange:
              profile.getters.find(
                (row: any) => row.addOwnRadius === sample.addOwnRadius,
              ).sightRange / 1000,
            nativePrimaryScore: true as const,
            nativePrimaryGeometry: true as const,
          };
          const target = {
            x: origin.x + sample.point.x / 1000,
            y: origin.y + sample.point.y / 1000,
            radius: sample.targetRadius / 1000,
            targetScoreBias: sample.fieldAC,
            kind: (sample.targetFlags["0x60"] || sample.targetFlags["0x64"]
              ? "tower"
              : sample.targetFlags["0x68"]
                ? "building"
                : "troop") as "tower" | "building" | "troop",
          };
          expect(
            primaryCandidateVisible(viewer, target),
            `${owner}:${sample.target}:${sample.case}:${sample.addOwnRadius}:${sample.teamIndex}:${origin.x}`,
          ).toBe(sample.setterRequests.length > 0);
        }
    },
  );

function make(version: 29 | 30 = 30) {
  const initial = new Battle({ seed: 3001, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const body of battle.entities)
    Object.assign(body, { active: false, x: 60, y: 60 });
  return battle;
}
function spawn(battle: Battle, card: CardId, team: Team, x: number, y: number) {
  (battle as any).spawn(card, team, x, y);
  const body = battle.entities.at(-1)!;
  Object.assign(body, {
    x,
    y,
    deploy: 0,
    age: 3,
    active: false,
    speed: 0,
    hp: 1e6,
    maxHp: 1e6,
    lifetime: undefined,
  });
  return body;
}
for (const version of [29, 30] as const)
  it.each(["blue", "red"] as const)(
    `uses source Hog clipping for fresh scans but keeps retained locks in rules ${version} (%s)`,
    (team) => {
      const battle = make(version),
        enemy = team === "blue" ? "red" : "blue";
      const actor = spawn(battle, "hog-rider", team, 2, 16);
      Object.assign(actor, { active: true, cooldown: 1000 });
      const cannon = spawn(
        battle,
        "cannon",
        enemy,
        9,
        team === "red" ? 22 : 10,
      );
      const crown = battle.entities.find(
        (body) => body.team === enemy && body.card === "tower" && !body.king,
      )!;
      Object.assign(crown, { x: 4, y: team === "red" ? 26 : 6 });
      battle.step();
      expect(actor.target).toBe(version === 30 ? crown.id : cannon.id);
      Object.assign(cannon, {
        x: actor.x,
        y: actor.y + (team === "red" ? 1 : -1),
      });
      actor.target = cannon.id;
      battle.step();
      expect(actor.target).toBe(cannon.id);
    },
  );
for (const version of [29, 30] as const)
  it.each(["blue", "red"] as const)(
    `extends fresh Cannon sight for Crown targets without extending attack range in rules ${version} (%s)`,
    (team) => {
      const battle = make(version),
        enemy = team === "blue" ? "red" : "blue";
      const actor = spawn(battle, "cannon", team, 8, 16);
      actor.active = true;
      const crown = battle.entities.find(
        (body) => body.team === enemy && !body.king,
      )!;
      Object.assign(crown, {
        x: 8,
        y: 16 + (team === "red" ? 8.5 : -8.5),
        hp: 1e6,
        maxHp: 1e6,
      });
      for (let i = 0; i < 90; i++) battle.step();
      expect(actor.target).toBe(version === 30 ? crown.id : null);
      expect(crown.hp).toBe(1e6);
      crown.y = 16 + (team === "red" ? 3 : -3);
      for (let i = 0; i < 90; i++) battle.step();
      expect(crown.hp).toBeLessThan(1e6);
    },
  );
it.each([29, 30] as const)(
  "preserves distant structure fallback in rules %s",
  (version) => {
    const battle = make(version);
    const actor = spawn(battle, "hog-rider", "red", 2, 16);
    Object.assign(actor, { active: true, cooldown: 1000 });
    const cannon = spawn(battle, "cannon", "blue", 9, 22);
    battle.step();
    expect(actor.target).toBe(cannon.id);
  },
);
it("uses score-adjusted fresh Mortar minimum while retaining an established lock", () => {
  const battle = make();
  const actor = spawn(battle, "mortar", "red", 8, 16);
  Object.assign(actor, { active: true, cooldown: 1000 });
  const child = spawn(battle, "goblins", "blue", 8, 20.6);
  child.targetScoreBias = 1600;
  battle.step();
  expect(actor.target).toBe(null);
  child.targetScoreBias = 0;
  battle.step();
  expect(actor.target).toBe(child.id);
  child.targetScoreBias = 1600;
  battle.step();
  expect(actor.target).toBe(child.id);
});
it("preserves the class policy in guest snapshots and omits it from historical bodies", () => {
  for (const version of [29, 30] as const) {
    const battle = make(version);
    spawn(battle, "hog-rider", "blue", 8, 20);
    for (const team of ["blue", "red"] as const)
      expect(
        perspective(snapshot(battle), team).entities.every(
          (body) => !!body.nativePrimaryGeometry === (version === 30),
        ),
      ).toBe(true);
  }
});

it("keeps source-clipped AI building proposals and movement leads aligned with combat", () => {
  const leads = [];
  for (const version of [29, 30] as const) {
    const battle = make(version);
    const crown = battle.entities.find(
      (body) => body.team === "blue" && !body.king,
    )!;
    Object.assign(crown, { x: 4, y: 29.5 });
    const balloon = spawn(battle, "balloon", "red", 2, 20);
    const before = JSON.stringify(snapshot(battle));
    expect(
      buildingLureTarget(
        "cannon",
        "blue",
        balloon,
        battle.entities,
        (point) => point.x === 9 && point.y === 22,
      ),
    ).toEqual(version === 29 ? { x: 9, y: 22 } : undefined);
    expect(JSON.stringify(snapshot(battle))).toBe(before);
    Object.assign(balloon, { hp: 0 });
    Object.assign(crown, { x: 4, y: 26 });
    spawn(battle, "cannon", "blue", 9, 22);
    const hog = spawn(battle, "hog-rider", "red", 2, 16);
    Object.assign(hog, { active: true, speed: CARD_MAP["hog-rider"].speed });
    const lead = meleeInterceptTarget(
      "knight",
      "blue",
      hog,
      battle.entities,
      () => true,
    );
    expect(lead).toBeDefined();
    leads.push(lead!);
  }
  expect(leads[1].x).toBeLessThan(leads[0].x);
  expect(leads[1].y).toBeGreaterThan(leads[0].y);
});

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
it("preserves complete rules-29 matches with Barrel landings, buffs and historical AI", () => {
  expect(historical.sourceCommit).toBe("9beeaf6");
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
    replay: { ...old, version: 30, actions: [], duration: 12000 } as Replay,
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
  expect(replay.rulesVersion).toBe(30);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
