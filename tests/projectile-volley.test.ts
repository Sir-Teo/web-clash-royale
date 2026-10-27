import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { attackFlight } from "../src/game/attack-flight";
import { attackReach } from "../src/game/attack-range";
import {
  volleyOffsets,
  projectileVolley,
  hasProjectileVolley,
} from "../src/game/projectile-volley";
import {
  snapshot,
  perspective,
  applySnapshot,
} from "../src/network/perspective";
import golden from "./fixtures/projectile-volley-rules40-golden.json";
function match(version: Replay["version"] = 41) {
  const b = new Battle({
    replay: {
      ...new Battle({ seed: 5017, ai: false }).exportReplay(),
      version,
    },
  });
  for (const e of b.entities) e.active = false;
  return b;
}
function cast(
  b: Battle,
  card: CardId,
  team: Team,
  x = 4,
  y = team === "blue" ? 22 : 10,
) {
  const ids = new Set(b.entities.map((e) => e.id));
  if (card === "lava-pup") (b as any).spawn(card, team, x, y, false, 0);
  else {
    b.players[team].elixir = 10;
    b.players[team].hand[0] = card;
    expect(b.play(team, 0, x, y).ok).toBe(true);
  }
  return b.entities.filter((e) => !ids.has(e.id));
}
function scene(alias: string, team: Team, version: Replay["version"] = 41) {
  const b = match(version);
  let actor: Entity;
  if (
    alias.endsWith("-tower") &&
    ["king-tower", "princess-tower"].includes(alias)
  )
    actor = b.entities.find(
      (e) => e.team === team && !!e.king === (alias === "king-tower"),
    )!;
  else {
    const bodies = cast(b, alias as CardId, team);
    actor = bodies[0];
    for (const body of bodies.slice(1)) body.active = false;
  }
  Object.assign(actor, {
    x: 4,
    y: team === "blue" ? 22 : 10,
    deploy: 0,
    active: true,
    activation: 0,
    cooldown: 0,
    speed: 0,
    lifetime: undefined,
  });
  if (actor.card === "sparky") actor.sparkyCharge = 4.5;
  const enemy = team === "blue" ? "red" : "blue";
  const victim = cast(b, "cannon", enemy)[0];
  const reach = attackReach(actor, victim) - 0.05;
  Object.assign(victim, {
    x: actor.x + reach * 0.6,
    y: actor.y + (team === "blue" ? -1 : 1) * reach * 0.8,
    deploy: 0,
    active: false,
    hp: 1e6,
    maxHp: 1e6,
    speed: 0,
    lifetime: undefined,
  });
  actor.target = victim.id;
  return { b, actor, victim };
}
function digest(b: Battle) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (b as any)[key]]),
        ),
      ),
    )
    .digest("hex");
}
it("retains complete independently captured rules-40 worlds and audio", () => {
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
          )) {
            expect(
              b.play(
                "blue",
                b.players.blue.hand.indexOf(action.card as CardId),
                action.x,
                action.y,
              ).ok,
            ).toBe(true);
          }
        b.step();
      }
      expect(digest(b), `${row.replay.seed}:${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  }
});
it("records and replays a complete current volley game", () => {
  const row = golden.cases[2];
  const b = new Battle({ replay: { ...row.replay, version: 41 } as Replay });
  let used = false;
  for (let n = 0; n < 12000 && !b.winner; n++) {
    b.step();
    used ||= b.projectiles.some(
      (p) => b.entities.find((e) => e.id === p.source)?.nativeProjectileVolley,
    );
  }
  expect(used).toBe(true);
  expect(b.winner).toBeTruthy();
  const replay = new Battle({ replay: b.exportReplay() });
  for (let n = 0; n < b.tick; n++) replay.step();
  expect(replay.rulesVersion).toBe(41);
  expect(digest(replay)).toBe(digest(b));
});

it("pins source/output hashes and reproduces all native volley offsets and request goals", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/projectile-volley-manifest.json", "utf8"),
  );
  for (const file of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(file.path)).digest("hex"),
    ).toBe(file.sha256);
  const native = JSON.parse(
    readFileSync(
      "reference/client/attack-projectile-goals-native-trace.json",
      "utf8",
    ),
  );
  expect(native.sha256).toBe(manifest.nativeSha256);
  let shots = 0;
  for (const row of [...native.cases, ...native.controls]) {
    let index = 0;
    const offsets = volleyOffsets(row.fields, (bound) => {
      const request = row.rngRequests[index++];
      expect(bound).toBe(request.upperExclusive);
      return request.providedResult;
    });
    expect(index).toBe(row.rngRequests.length);
    const requests = row.requests.filter((p: any) => p.kind === "shoot");
    for (let i = 0; i < offsets.length; i++) {
      const goal =
        row.fields.rawPointOverride > 0
          ? row.alternatePoint
          : {
              x: row.cachedPoint.x + offsets[i].x,
              y: row.cachedPoint.y + offsets[i].y,
            };
      expect(requests[i].arguments.slice(3, 5)).toEqual([goal.x, goal.y]);
      shots++;
    }
  }
  expect(shots).toBe(584);
});
for (const team of ["blue", "red"] as const)
  for (const lost of [false, true])
    it(`${team} emits the native circular volley after ${lost ? "victim loss" : "a live pending attack"}`, () => {
      for (const seed of [1, 19, 5017, 812345, 0xffffffff]) {
        const { b, actor, victim } = scene("princess", team);
        actor.volleyRandomState = seed;
        for (let n = 0; n < 30 && !actor.pendingAttack; n++) b.step();
        expect(actor.pendingAttack).toBeDefined();
        if (lost) victim.hp = 0;
        let before = actor.volleyRandomState!;
        for (let n = 0; n < 50; n++) {
          before = actor.volleyRandomState!;
          b.step();
          if (b.projectiles.some((p) => p.source === actor.id)) break;
        }
        const shots = b.projectiles.filter((p) => p.source === actor.id);
        expect(actor.nativeProjectileVolley).toBe(true);
        expect(shots).toHaveLength(5);
        expect(shots.filter((p) => p.damage > 0)).toHaveLength(1);
        const center = shots[0];
        let state = before;
        for (let i = 1; i < 5; i++) {
          state = (Math.imul(1664525, state) + 1013904223) >>> 0;
          const radius = 625 + Math.floor((state / 4294967296) * 1875);
          const angle = (i * 72 * Math.PI) / 180;
          const dx = Math.trunc(
            (radius * Math.round(Math.cos(angle) * 1024)) / 1024,
          );
          const dy = Math.trunc(
            (radius * Math.round(Math.sin(angle) * 1024)) / 1024,
          );
          expect(shots[i].tx).toBeCloseTo(center.tx + dx / 1000, 12);
          expect(shots[i].ty).toBeCloseTo(center.ty + dy / 1000, 12);
          expect(shots[i].decorative).toBe(true);
          expect(shots[i].damage).toBe(0);
          expect(shots[i].target).toBeNull();
          const flight = attackFlight(actor, {
            x: shots[i].tx,
            y: shots[i].ty,
          })!;
          expect({ x: shots[i].x, y: shots[i].y }).toEqual(flight.start);
          expect(shots[i].duration).toBeCloseTo(flight.duration, 12);
        }
        expect(actor.volleyRandomState).toBe(state);
        expect(
          b.audioEvents.filter(
            (a) => a.phase === "launch" && a.actor === actor.id,
          ),
        ).toHaveLength(1);
        actor.active = false;
        for (
          let n = 0;
          n < 100 && b.projectiles.some((p) => p.source === actor.id);
          n++
        )
          b.step();
        if (!lost) expect(victim.hp).toBeLessThan(victim.maxHp);
      }
    });
it("keeps historical offsets and RNG consumption while allowing source edge goals beyond the arena", () => {
  for (const version of [40, 41] as const) {
    const { b, actor } = scene("princess", "blue", version);
    const before = b.randomState;
    (b as any).releaseProjectileAttack(
      actor,
      undefined,
      { x: 0.05, y: 0.05 },
      100,
    );
    const shots = b.projectiles.filter((p) => p.source === actor.id);
    if (version === 40) {
      expect(actor.nativeProjectileVolley).toBeUndefined();
      expect(b.randomState).toBe(before);
      expect(shots.slice(1).map((p) => [p.tx, p.ty])).toEqual(
        [
          [-2, 0.28],
          [-1, 0.14],
          [1, 0.14],
          [2, 0.28],
        ].map(([i, y]) => [
          Math.max(0.5, 0.05 + i * 0.38),
          Math.max(0.6, 0.05 + y),
        ]),
      );
    } else {
      expect(b.randomState).toBe(before);
      expect(actor.volleyRandomState).toBeTypeOf("number");
      expect(shots.some((p) => p.tx < 0)).toBe(true);
      expect(shots.some((p) => p.ty < 0)).toBe(true);
    }
  }
});
it("retains volley policies and actual goals through snapshots, Mirror and Clone", () => {
  const { b, actor } = scene("princess", "red");
  (b as any).releaseProjectileAttack(
    actor,
    undefined,
    { x: 5.2, y: 21.7 },
    100,
  );
  const host = snapshot(b),
    view = perspective(host, "red");
  expect(
    view.entities.find((e) => e.id === actor.id)!.nativeProjectileVolley,
  ).toBe(true);
  for (const shot of b.projectiles) {
    const guest = view.projectiles.find((p) => p.id === shot.id)!;
    expect(guest.tx).toBeCloseTo(18 - shot.tx, 12);
    expect(guest.ty).toBeCloseTo(32 - shot.ty, 12);
  }
  const guest = match(40);
  applySnapshot(guest, host, "red");
  expect(
    guest.entities.find((e) => e.id === actor.id)!.nativeProjectileVolley,
  ).toBe(true);
  applySnapshot(guest, snapshot(match(40)), "red");
  expect(guest.entities.every((e) => !e.nativeProjectileVolley)).toBe(true);
  const fresh = scene("princess", "blue");
  const mirror = cast(fresh.b, "mirror", "blue", 8)[0];
  expect(mirror.card).toBe("princess");
  expect(mirror.nativeProjectileVolley).toBe(true);
  cast(fresh.b, "clone", "blue", fresh.actor.x, fresh.actor.y);
  fresh.b.step();
  const clone = fresh.b.entities.find((e) => e.clone && e.card === "princess")!;
  expect(clone.nativeProjectileVolley).toBe(true);
  expect(clone.pendingAttack).toBeUndefined();
  expect(clone.volleyRandomState).toBeUndefined();
  expect(hasProjectileVolley("musketeer")).toBe(false);
  const control = cast(fresh.b, "musketeer", "blue")[0];
  expect(
    projectileVolley(control, { x: 0, y: 0 }, () => {
      throw Error("Unexpected draw");
    }),
  ).toBeUndefined();
});
it("isolates saved per-body volley streams from AI draws and gives clones a fresh stream", () => {
  const first = scene("princess", "blue"),
    second = scene("princess", "blue");
  for (let n = 0; n < 100; n++) second.b.random();
  const fire = ({ b, actor }: typeof first) => {
    (b as any).releaseProjectileAttack(actor, undefined, { x: 5, y: 15 }, 100);
    return b.projectiles.map((p) => [p.tx, p.ty]);
  };
  expect(fire(first)).toEqual(fire(second));
  expect(first.actor.volleyRandomState).toBe(second.actor.volleyRandomState);
  const saved = structuredClone(snapshot(first.b));
  expect(
    saved.entities.find((e) => e.id === first.actor.id)!.volleyRandomState,
  ).toBe(first.actor.volleyRandomState);
  const before = first.actor.volleyRandomState;
  fire(first);
  expect(first.actor.volleyRandomState).not.toBe(before);
  expect(
    saved.entities.find((e) => e.id === first.actor.id)!.volleyRandomState,
  ).toBe(before);
  first.actor.active = false;
  cast(first.b, "clone", "blue", first.actor.x, first.actor.y);
  first.b.step();
  const clone = first.b.entities.find((e) => e.clone && e.card === "princess")!;
  expect(clone.volleyRandomState).toBeUndefined();
  (first.b as any).releaseProjectileAttack(
    clone,
    undefined,
    { x: 5, y: 15 },
    100,
  );
  expect(clone.volleyRandomState).toBeTypeOf("number");
  expect(clone.volleyRandomState).not.toBe(before);
});
