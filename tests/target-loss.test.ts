import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { attackReach } from "../src/game/attack-range";
import { targetLossMode } from "../src/game/target-loss";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import source from "../src/game/target-loss-data.json";
import golden from "./fixtures/target-loss-rules38-golden.json";
const cards = [
  "valkyrie",
  "bomber",
  "princess",
  "bowler",
  "executioner",
  "mortar",
  "bomb-tower",
] as const;
const modes = [
  { name: "normal", rage: false, slow: false, rate: 1 },
  { name: "rage", rage: true, slow: false, rate: 67 / 50 },
  { name: "slow", rage: false, slow: true, rate: 32 / 50 },
  { name: "both", rage: true, slow: true, rate: 43 / 50 },
];
function match(version: Replay["version"] = 39) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 2081, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(b: Battle, card: CardId, team: Team, x: number, y: number) {
  b.players[team].hand[0] = card;
  b.players[team].elixir = 10;
  const ids = new Set(b.entities.map((e) => e.id));
  expect(b.play(team, 0, x, y).ok).toBe(true);
  return b.entities.filter((e) => !ids.has(e.id));
}
function scene(
  card: CardId,
  team: Team,
  version: Replay["version"] = 39,
  mode = modes[0],
) {
  const b = match(version),
    direction = team === "blue" ? -1 : 1;
  const actors = cast(b, card, team, 4, team === "blue" ? 22 : 10),
    actor = actors[0];
  for (const other of actors.slice(1)) other.hp = 0;
  Object.assign(actor, {
    x: 4,
    y: team === "blue" ? 22 : 10,
    deploy: 0,
    cooldown: 0,
    speed: 0,
    lifetime: undefined,
  });
  actor.rage = mode.rage ? { remaining: 100 } : undefined;
  actor.slow = mode.slow ? { remaining: 100 } : undefined;
  const enemy = team === "blue" ? "red" : "blue";
  const victim = cast(b, "knight", enemy, 4, team === "blue" ? 10 : 22)[0];
  Object.assign(victim, {
    x: actor.x,
    y: actor.y + direction * (attackReach(actor, victim) - 0.01),
    active: false,
    deploy: 0,
    hp: 100000,
    maxHp: 100000,
    speed: 0,
  });
  b.step();
  expect(actor.pendingAttack?.target).toBe(victim.id);
  return { b, actor, victim, enemy, direction };
}
function bystander(s: ReturnType<typeof scene>) {
  const body = cast(s.b, "knight", s.enemy, 4, s.enemy === "blue" ? 22 : 10)[0];
  Object.assign(body, {
    x: s.actor.x,
    y: s.actor.y + s.direction * (attackReach(s.actor, body) + 0.3),
    active: false,
    deploy: 0,
    hp: 100000,
    maxHp: 100000,
    speed: 0,
  });
  return body;
}
function kill(b: Battle, target: Entity) {
  (b as any).hurt(target, target.hp);
  expect(target.hp).toBe(0);
}
const launches = (b: Battle, actor: Entity) =>
  b.audioEvents.filter((e) => e.actor === actor.id && e.phase === "launch");
it("pins native policy/clock/request witnesses and all source/output hashes", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/target-loss-manifest.json", "utf8"),
  );
  for (const input of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(input.path)).digest("hex"),
    ).toBe(input.sha256);
  expect(Object.keys(source.modes)).toHaveLength(7);
  const clock = JSON.parse(
    readFileSync(
      "reference/client/target-loss-clock-native-trace.json",
      "utf8",
    ),
  );
  const requests = JSON.parse(
    readFileSync(
      "reference/client/target-loss-request-native-trace.json",
      "utf8",
    ),
  );
  expect(manifest.nativeSha256).toBe(clock.sha256);
  for (const [name, mode] of Object.entries(source.modes)) {
    const witnesses = clock.cases.filter((r: any) => r.sourceName === name);
    expect(witnesses).toHaveLength(16);
    for (const row of witnesses)
      expect(row.pulses.filter((p: any) => p.target === null)).toHaveLength(1);
    for (const row of requests.cases.filter(
      (r: any) => r.sourceName === name,
    )) {
      const packet = row.requests.find(
        (r: any) => r.kind === (mode === "self" ? "area" : "shoot"),
      );
      const point = mode === "self" ? row.casterPoint : row.cachedPoint;
      const index = mode === "self" ? 1 : 3;
      expect(packet.arguments.slice(index, index + 2)).toEqual([
        point.x,
        point.y,
      ]);
    }
  }
});
for (const team of ["blue", "red"] as const) {
  for (const card of cards)
    for (const mode of modes)
      it(`${team} ${card} completes one ${mode.name} pending attack after its victim dies`, () => {
        const s = scene(card, team, 39, mode),
          { b, actor, victim } = s;
        const witness = bystander(s),
          point = { x: victim.x, y: victim.y };
        const before = actor.pendingAttack!.remaining;
        expect(actor.nativeLostAttack).toBe(
          card === "valkyrie" ? "self" : "point",
        );
        if (card !== "valkyrie")
          expect(actor.pendingAttack!.lastPoint).toEqual(point);
        kill(b, victim);
        b.step();
        expect(actor.pendingAttack!.remaining).toBeCloseTo(
          before - STEP * mode.rate,
          12,
        );
        let shotSeen = false;
        for (let n = 0; n < 150 && witness.hp === witness.maxHp; n++) {
          b.step();
          for (const shot of b.projectiles.filter(
            (p) => p.source === actor.id,
          )) {
            shotSeen = true;
            expect(shot.target).toBeNull();
            expect(shot.homing).toBe(false);
            if (!["bowler", "executioner"].includes(card) && !shot.decorative)
              expect({ x: shot.tx, y: shot.ty }).toEqual(point);
          }
        }
        expect(witness.hp).toBeLessThan(witness.maxHp);
        expect(shotSeen).toBe(card !== "valkyrie");
        expect(actor.pendingAttack).toBeUndefined();
        for (let n = 0; n < 90; n++) b.step();
        expect(launches(b, actor)).toHaveLength(card === "valkyrie" ? 0 : 1);
        if (card === "valkyrie")
          expect(
            b.events.filter((e) => e.type === "hit" && e.card === card),
          ).toHaveLength(1);
      });
  for (const card of cards)
    it(`${team} rules 38 cancels the same dead-victim ${card} windup`, () => {
      const s = scene(card, team, 38),
        witness = bystander(s);
      kill(s.b, s.victim);
      for (let n = 0; n < 120; n++) s.b.step();
      expect(s.actor.nativeLostAttack).toBeUndefined();
      expect(s.actor.pendingAttack).toBeUndefined();
      expect(witness.hp).toBe(witness.maxHp);
      expect(launches(s.b, s.actor)).toHaveLength(0);
    });
  it(`${team} self-area release follows a caster moved after victim removal`, () => {
    const s = scene("valkyrie", team);
    kill(s.b, s.victim);
    s.actor.x += 3;
    const witness = bystander(s);
    witness.x = s.actor.x;
    for (let n = 0; n < 30 && witness.hp === witness.maxHp; n++) s.b.step();
    expect(witness.hp).toBeLessThan(witness.maxHp);
  });
  it(`${team} point release retains the last valid point while its caster moves`, () => {
    const s = scene("bomber", team),
      witness = bystander(s);
    // A live refresh updates the point before it is retained on death.
    s.victim.x += 0.1;
    const point = { x: s.victim.x, y: s.victim.y };
    s.b.step();
    expect(s.actor.pendingAttack!.lastPoint).toEqual(point);
    kill(s.b, s.victim);
    s.actor.x += 3;
    let shot;
    for (let n = 0; n < 30 && !shot; n++) {
      s.b.step();
      shot = s.b.projectiles.find((p) => p.source === s.actor.id);
    }
    expect(shot).toMatchObject({
      tx: point.x,
      ty: point.y,
      target: null,
      homing: false,
    });
    for (let n = 0; n < 90 && witness.hp === witness.maxHp; n++) s.b.step();
    expect(witness.hp).toBeLessThan(witness.maxHp);
  });
  for (const card of ["valkyrie", "bomber", "bowler"] as const)
    it(`${team} stun interrupts a lost-target ${card} windup`, () => {
      const s = scene(card, team);
      kill(s.b, s.victim);
      s.actor.stun = 0.5;
      for (let n = 0; n < 90; n++) s.b.step();
      expect(s.actor.pendingAttack).toBeUndefined();
      expect(launches(s.b, s.actor)).toHaveLength(0);
    });
  it(`${team} living friendly and hidden targets still cancel`, () => {
    for (const hidden of [false, true]) {
      const s = scene("bomber", team);
      if (hidden) s.victim.burrow = { phase: "hidden", idle: 0, exposure: 0 };
      else s.victim.team = team;
      s.b.step();
      expect(s.actor.pendingAttack).toBeUndefined();
      expect(launches(s.b, s.actor)).toHaveLength(0);
    }
  });
  it(`${team} a caster killed during the windup emits no lost-target attack`, () => {
    const s = scene("bomber", team);
    kill(s.b, s.victim);
    kill(s.b, s.actor);
    for (let n = 0; n < 90; n++) s.b.step();
    expect(launches(s.b, s.actor)).toHaveLength(0);
  });
}
it("does not give homing, direct or earlier bodies the continuation policy", () => {
  for (const version of [5, 19, 28, 37, 38] as const) {
    for (const card of cards) {
      const b = match(version);
      expect(cast(b, card, "blue", 4, 22)[0].nativeLostAttack).toBeUndefined();
    }
  }
  const b = match();
  expect(b.entities.every((e) => e.nativeLostAttack === undefined)).toBe(true);
  for (const card of [
    "knight",
    "musketeer",
    "sparky",
    "electro-wizard",
    "balloon",
    "inferno-tower",
  ] as const) {
    expect(targetLossMode({ card })).toBeUndefined();
    expect(cast(b, card, "blue", 4, 22)[0].nativeLostAttack).toBeUndefined();
  }
});
it("cancels a point continuation whose snapshot has no retained point", () => {
  const s = scene("bomber", "blue");
  delete s.actor.pendingAttack!.lastPoint;
  kill(s.b, s.victim);
  s.b.step();
  expect(s.actor.pendingAttack).toBeUndefined();
  expect(launches(s.b, s.actor)).toHaveLength(0);
});
it("preserves and rotates pending points without mutating the host, and clears older-host policy", () => {
  const s = scene("bomber", "blue"),
    packet = snapshot(s.b),
    before = JSON.stringify(packet);
  const guest = match(38);
  applySnapshot(guest, packet, "red");
  const viewed = guest.entities.find((e) => e.id === s.actor.id)!;
  expect(viewed.nativeLostAttack).toBe("point");
  expect(viewed.pendingAttack!.lastPoint).toEqual({
    x: 18 - s.victim.x,
    y: 32 - s.victim.y,
  });
  expect(JSON.stringify(packet)).toBe(before);
  const twice = perspective(perspective(packet, "red"), "red").entities.find(
    (e) => e.id === s.actor.id,
  )!;
  expect(twice.pendingAttack!.lastPoint!.x).toBeCloseTo(s.victim.x, 12);
  expect(twice.pendingAttack!.lastPoint!.y).toBeCloseTo(s.victim.y, 12);
  applySnapshot(guest, snapshot(match(38)), "blue");
  expect(guest.entities.every((e) => !e.nativeLostAttack)).toBe(true);
});
it("Mirror starts fresh and Clone keeps eligibility while dropping copied pending aim", () => {
  const s = scene("bomber", "blue");
  s.b.players.blue.lastPlayed = "bomber";
  const mirror = cast(s.b, "mirror", "blue", 14, 22)[0];
  expect(mirror.nativeLostAttack).toBe("point");
  expect(mirror.pendingAttack).toBeUndefined();
  cast(s.b, "clone", "blue", s.actor.x, s.actor.y);
  s.b.step();
  const clone = s.b.entities.find((e) => e.clone && e.card === "bomber")!;
  expect(clone.nativeLostAttack).toBe("point");
  expect(clone.pendingAttack).toBeUndefined();
});
const digest = (b: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (b as any)[key]]),
        ),
      ),
    )
    .digest("hex");
it("preserves whole rules-38 worlds including all seven eligible sources and historical AI", () => {
  expect(golden.sourceCommit).toBe("76cf9bc");
  for (const card of cards)
    expect(golden.cases.some((row) => row.deployed.includes(card))).toBe(true);
  for (const row of golden.cases) {
    const b = new Battle({ replay: row.replay as Replay });
    if (row.ai) {
      (b as any).ai = true;
      (b as any).replayActions = null;
    }
    for (const checkpoint of row.checkpoints) {
      while (b.tick < checkpoint.tick && !b.winner) {
        if (row.ai)
          for (const action of row.replay.actions.filter(
            (a) => a.team === "blue" && a.tick === b.tick,
          ))
            expect(
              b.play(
                "blue",
                b.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  }
});
it("records and replays a complete current match with pending point/self attacks", () => {
  const old = golden.cases[0].replay,
    b = new Battle({
      replay: { ...old, version: 39, actions: [], duration: 12000 } as Replay,
    });
  const checkpoints = [];
  let loaded = false;
  while (!b.winner && b.tick < 12000) {
    for (const a of old.actions.filter((a) => a.tick === b.tick)) {
      const team = a.team as Team,
        slot = b.players[team].hand.indexOf(a.card as CardId);
      if (slot >= 0) b.play(team, slot, a.x, a.y);
    }
    b.step();
    loaded ||= b.entities.some((e) => e.nativeLostAttack && e.pendingAttack);
    if (b.tick % 300 === 0 || b.winner)
      checkpoints.push({ tick: b.tick, digest: digest(b) });
  }
  expect(b.winner).toBeTruthy();
  expect(loaded).toBe(true);
  const replay = new Battle({ replay: b.exportReplay() });
  expect(replay.rulesVersion).toBe(39);
  for (const p of checkpoints) {
    while (replay.tick < p.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(p.digest);
  }
});
