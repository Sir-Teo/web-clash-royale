import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Battle,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { attackReach } from "../src/game/attack-range";
import { createKingDefense } from "../src/game/king-defense";
import { perspective, snapshot } from "../src/network/perspective";
import native from "../reference/client/attack-range-native-trace.json";
import historical from "./fixtures/attack-range-rules23-golden.json";
import type { CardId } from "../src/game/cards";

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

it("pins native geometry, archived inputs and the imported radius factor", () => {
  const manifest = JSON.parse(
    readFileSync("reference/client/attack-range-manifest.json", "utf8"),
  );
  for (const entry of [...manifest.inputs, manifest.output])
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  expect(manifest.nativeSha256).toBe(native.sha256);
  expect(native.sha256).toBe(
    "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
  );
});

it.each(native.profiles)(
  "matches every captured maximum boundary for $name",
  (profile) => {
    for (const sample of profile.samples) {
      const body = {
        radius: profile.CollisionRadius / 1000,
        range: profile.Range / 1000,
        rangeRadiusFactor: Number(sample.addOwnRadius),
      };
      const reach = attackReach(body, { radius: sample.targetRadius / 1000 });
      // Source integer coordinates are retained; this checks resampled geometry,
      // without claiming that moving browser bodies use native quantization.
      const inside =
        Math.round(reach * 1000) ** 2 >= sample.x ** 2 + sample.y ** 2;
      expect(inside, JSON.stringify(sample)).toBe(sample.inRange);
    }
  },
);

function scene(
  card: CardId | "king" | "princess",
  team: Team,
  version: 23 | 24,
) {
  const initial = new Battle({ seed: 192, ai: false });
  const battle = new Battle({ replay: { ...initial.exportReplay(), version } });
  for (const e of battle.entities)
    Object.assign(e, { active: false, x: 30, y: 30 });
  let attacker: Entity;
  if (card === "king" || card === "princess")
    attacker = battle.entities.find(
      (e) => e.team === team && !!e.king === (card === "king"),
    )!;
  else {
    (battle as any).spawn(card, team, 0, 0);
    attacker = battle.entities.at(-1)!;
  }
  Object.assign(attacker, {
    x: 0,
    y: 0,
    deploy: 0,
    cooldown: 0,
    active: true,
    speed: 0,
  });
  (battle as any).spawn("cannon", team === "blue" ? "red" : "blue", 0, 0);
  const target = battle.entities.at(-1)!;
  Object.assign(target, {
    deploy: 0,
    active: false,
    hp: 100000,
    maxHp: 100000,
    lifetime: undefined,
  });
  attacker.target = target.id;
  return { battle, attacker, target };
}

describe.each(["blue", "red"] as const)(
  "live maximum attack reach (%s)",
  (team) => {
    it.each([
      "knight",
      "musketeer",
      "balloon",
      "inferno-dragon",
      "inferno-tower",
      "cannon",
      "mortar",
      "king",
      "princess",
    ] as const)(
      "%s starts at the native boundary, rejects one source unit farther and retains old recordings",
      (card) => {
        for (const version of [23, 24] as const)
          for (const offset of [0, 0.001]) {
            const { battle, attacker, target } = scene(card, team, version);
            target.x =
              attacker.range + target.radius + attacker.radius + offset;
            battle.step();
            expect(
              !!(attacker.pendingAttack || attacker.inferno),
              `${version}:${offset}`,
            ).toBe(version === 24 && offset === 0);
            expect(attacker.rangeRadiusFactor).toBe(
              version === 24 ? 1 : undefined,
            );
          }
      },
    );
  },
);

it("retains a pending windup within the extended ring and cancels beyond it", () => {
  const { battle, attacker, target } = scene("knight", "blue", 24);
  target.x = attackReach(attacker, target) - 0.01;
  battle.step();
  expect(attacker.pendingAttack).toBeTruthy();
  battle.step();
  expect(attacker.pendingAttack).toBeTruthy();
  target.x = attackReach(attacker, target) + 0.001;
  battle.step();
  expect(attacker.pendingAttack).toBeUndefined();
});

it.each(["blue", "red"] as const)(
  "King defense predicts actual extended-range Inferno damage (%s)",
  (team) => {
    const b = new Battle({ seed: 198, ai: false });
    for (const e of b.entities) e.active = false;
    const king = b.entities.find((e) => e.team === team && e.king)!;
    const enemy = team === "blue" ? "red" : "blue";
    (b as any).spawn("inferno-dragon", enemy, king.x, king.y);
    const attacker = b.entities.at(-1)!;
    Object.assign(attacker, {
      x: king.x + attacker.range + king.radius + attacker.radius - 0.01,
      deploy: 0,
      speed: 0,
      target: king.id,
      inferno: { target: king.id, stage: 2, elapsed: 4.2, hitTimer: 0.1 },
    });
    king.hp = 100;
    const forecast = createKingDefense(team, b.entities).baseline;
    expect(forecast).toBe(3);
    b.step();
    b.step();
    expect(b.winner).toBeNull();
    b.step();
    expect(b.winner).toBe(enemy);
    const mirrored = perspective(snapshot(b), "red");
    expect(
      mirrored.entities.find((e) => e.id === attacker.id)?.rangeRadiusFactor,
    ).toBe(1);
  },
);

it("preserves complete independently captured rules-23 games and AI decisions", () => {
  expect(historical.sourceCommit).toBe("e33aaf7");
  expect(historical.cases.some((row) => row.ai)).toBe(true);
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
            (a) => a.team === "blue" && a.tick === battle.tick,
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

it("records and replays a complete rules-24 game with identical world and RNG", () => {
  const old = historical.cases[0].replay;
  const live = new Battle({
    replay: { ...old, version: 24, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  while (!live.winner && live.tick < 12000) {
    for (const action of old.actions.filter((a) => a.tick === live.tick)) {
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
  expect(replay.rulesVersion).toBe(24);
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay)).toBe(checkpoint.digest);
  }
});
