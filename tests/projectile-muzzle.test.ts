import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  Battle,
  STEP,
  entityVisualHeight,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { attackFlight } from "../src/game/attack-flight";
import { attackReach } from "../src/game/attack-range";
import { combatTraits } from "../src/game/combat";
import {
  launchPoint,
  muzzleHeight,
  projectileMuzzleHeight,
  projectileMuzzle,
  hasProjectileMuzzle,
} from "../src/game/projectile-muzzle";
import {
  applySnapshot,
  perspective,
  snapshot,
} from "../src/network/perspective";
import data from "../src/game/projectile-muzzle-data.json";
import combat from "../src/game/combat-data.json";
import golden from "./fixtures/projectile-muzzle-rules39-golden.json";
const aliases = Object.entries(combat)
  .filter(([, v]) => v.projectile)
  .map(([k]) => k);
function match(version: Replay["version"] = 40) {
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
function scene(alias: string, team: Team, version: Replay["version"] = 40) {
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
it("pins source/output hashes and reproduces all 1,824 native launch requests", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/projectile-muzzle-manifest.json", "utf8"),
  );
  for (const file of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(file.path)).digest("hex"),
    ).toBe(file.sha256);
  const native = JSON.parse(
    readFileSync(
      "reference/client/projectile-launch-native-trace.json",
      "utf8",
    ),
  );
  expect(native.sha256).toBe(manifest.nativeSha256);
  expect(native.profiles).toHaveLength(27);
  expect(Object.keys(data.muzzles)).toHaveLength(26);
  for (const row of [...native.cases, ...native.controls]) {
    const point = launchPoint(
      {
        x: row.actorPoint.x / 1000,
        y: row.actorPoint.y / 1000,
        z: row.actorPoint.z / 1000,
        owner: row.owner,
      },
      { x: row.goal.x / 1000, y: row.goal.y / 1000 },
      {
        radius: row.fields.ProjectileStartRadius,
        z: row.fields.ProjectileStartZ,
        y: row.fields.ProjectileYOffset,
      },
    );
    expect(point.x).toBe(row.start.x / 1000);
    expect(point.y).toBe(row.start.y / 1000);
    expect(point.z).toBeCloseTo(row.start.z / 1000, 12);
  }
});
for (const team of ["blue", "red"] as const)
  for (const alias of aliases)
    it(`${team} ${alias} launches actual native geometry and height`, () => {
      const { b, actor, victim } = scene(alias, team);
      expect(actor.nativeProjectileMuzzle).toBe(true);
      const source = combatTraits(actor).source;
      expect(source).toBe(combat[alias as keyof typeof combat].source);
      let shot;
      let flight;
      for (let n = 0; n < 100; n++) {
        flight = attackFlight(actor, victim)!;
        b.step();
        shot = b.projectiles.find(
          (p) => p.source === actor.id && !p.decorative,
        );
        if (shot) break;
      }
      expect(shot, `${alias} must create a real shot`).toBeDefined();
      const f = (
        data.muzzles as Record<string, { z: number; constantHeight?: number }>
      )[source];
      expect(shot!.fromHeight).toBeCloseTo(
        f.constantHeight
          ? f.constantHeight / 1000
          : entityVisualHeight(actor) + f.z / 1000,
        12,
      );
      const start = projectileMuzzle(actor, victim)!;
      expect(flight!.start).toEqual({ x: start.x, y: start.y });
      const dx = flight!.end.x - start.x,
        dy = flight!.end.y - start.y,
        distance = Math.hypot(dx, dy),
        travel = Math.min(distance, flight!.speed! * STEP);
      expect(shot!.flight!.x).toBeCloseTo(
        start.x + (dx / distance) * travel,
        12,
      );
      expect(shot!.flight!.y).toBeCloseTo(
        start.y + (dy / distance) * travel,
        12,
      );
      if (actor.card !== "executioner" && actor.card !== "sparky")
        expect({ x: shot!.x, y: shot!.y }).toEqual(flight!.start);
      if (!["bowler", "executioner"].includes(actor.card))
        expect(flight!.duration).toBeCloseTo(
          Math.max(STEP, distance / flight!.speed!),
          12,
        );
      if (actor.card === "princess") {
        const shots = b.projectiles.filter((p) => p.source === actor.id);
        expect(shots).toHaveLength(5);
        for (const child of shots) {
          const f = attackFlight(actor, { x: child.tx, y: child.ty })!;
          expect({ x: child.x, y: child.y }).toEqual(f.start);
          expect(child.duration).toBeCloseTo(f.duration, 12);
        }
        expect(shots.filter((p) => p.damage > 0)).toHaveLength(1);
      }
    });
it("keeps older bodies and non-projectile attacks on their exact launch paths", () => {
  for (const alias of aliases) {
    const { actor, victim } = scene(alias, "blue", 39);
    expect(actor.nativeProjectileMuzzle).toBeUndefined();
    expect(projectileMuzzle(actor, victim)).toBeUndefined();
    expect(
      projectileMuzzleHeight(actor, entityVisualHeight(actor)),
    ).toBeUndefined();
  }
  for (const card of [
    "knight",
    "valkyrie",
    "tesla",
    "balloon",
    "electro-wizard",
    "inferno-dragon",
  ] as const) {
    const b = match(),
      actor = cast(b, card, "blue")[0];
    expect(hasProjectileMuzzle(card)).toBe(false);
    expect(actor.nativeProjectileMuzzle).toBeUndefined();
  }
});
it("rotates source muzzles through guest snapshots and respects older hosts", () => {
  const { b, actor, victim } = scene("king-tower", "red");
  const initial = projectileMuzzle(actor, victim)!;
  const host = snapshot(b),
    view = perspective(host, "red");
  const a = view.entities.find((e) => e.id === actor.id)!,
    v = view.entities.find((e) => e.id === victim.id)!;
  const rotated = projectileMuzzle(a, v)!;
  expect(rotated.x).toBeCloseTo(18 - initial.x, 12);
  expect(rotated.y).toBeCloseTo(32 - initial.y, 12);
  expect(rotated.z).toBe(initial.z);
  expect(host.entities.find((e) => e.id === actor.id)!.team).toBe("red");
  const guest = match(39);
  applySnapshot(guest, host, "red");
  expect(
    guest.entities.find((e) => e.id === actor.id)!.nativeProjectileMuzzle,
  ).toBe(true);
  applySnapshot(guest, snapshot(match(39)), "red");
  expect(guest.entities.every((e) => !e.nativeProjectileMuzzle)).toBe(true);
});
it("Mirror initializes a fresh muzzle policy and Clone preserves eligible bodies", () => {
  const { b, actor } = scene("musketeer", "blue");
  const mirrored = cast(b, "mirror", "blue", 8)[0];
  expect(mirrored.card).toBe("musketeer");
  expect(mirrored.nativeProjectileMuzzle).toBe(true);
  b.players.blue.hand[0] = "clone";
  b.players.blue.elixir = 10;
  expect(b.play("blue", 0, actor.x, actor.y).ok).toBe(true);
  b.step();
  const clone = b.entities.find((e) => e.clone && e.card === "musketeer")!;
  expect(clone.nativeProjectileMuzzle).toBe(true);
  expect(clone.pendingAttack).toBeUndefined();
});
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
it("retains complete independently captured rules-39 worlds and audio", () => {
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
it("records and replays a complete current muzzle game", () => {
  const row = golden.cases[2];
  const b = new Battle({ replay: { ...row.replay, version: 40 } as Replay });
  let used = false;
  for (let n = 0; n < 12000 && !b.winner; n++) {
    b.step();
    used ||= b.projectiles.some(
      (p) => b.entities.find((e) => e.id === p.source)?.nativeProjectileMuzzle,
    );
  }
  expect(used).toBe(true);
  expect(b.winner).toBeTruthy();
  const replay = new Battle({ replay: b.exportReplay() });
  for (let n = 0; n < b.tick; n++) replay.step();
  expect(replay.rulesVersion).toBe(40);
  expect(digest(replay)).toBe(digest(b));
});

it("reproduces the later absolute ConstantHeight stores across all 276 native cases", () => {
  const native = JSON.parse(
    readFileSync(
      "reference/client/projectile-height-native-trace.json",
      "utf8",
    ),
  );
  expect(native.profiles).toHaveLength(38);
  for (const row of [...native.cases, ...native.controls]) {
    expect(
      muzzleHeight(row.point.z / 1000, {
        radius: 0,
        z: 0,
        y: 0,
        constantHeight: row.constantHeight,
      }),
    ).toBe(row.stored.z / 1000);
  }
  const { actor } = scene("executioner", "blue");
  expect(projectileMuzzleHeight(actor, 100)).toBe(3);
});
