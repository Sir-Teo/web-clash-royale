import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Battle, STEP, type Replay, type Team } from "../src/game/engine";
import { deploymentTime } from "../src/game/deployment";
import type { CardId } from "../src/game/cards";
import { perspective, snapshot } from "../src/network/perspective";
import native from "../reference/client/deployment-native-trace.json";
import golden from "./fixtures/deployment-legacy-golden.json";

const cards = [
  "bats",
  "elite-barbarians",
  "guards",
  "ice-spirit",
  "fire-spirits",
] as const;
function scene(card: CardId, team: Team, version: 17 | 18) {
  const initial = new Battle({ seed: 125, ai: false });
  const battle = new Battle({
    replay: {
      ...initial.exportReplay(),
      version,
      actions: [],
      duration: 12000,
    },
  });
  battle.entities.forEach((e) => (e.active = false));
  battle.players[team].hand[0] = card;
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
  return battle;
}
const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        tick: battle.tick,
        entities: battle.entities,
        projectiles: battle.projectiles,
        areas: battle.areas,
        events: battle.events,
        audio: battle.audioEvents,
        players: battle.players,
        winner: battle.winner,
        reason: battle.reason,
        actions: battle.actions,
        randomState: (battle as any).randomState,
      }),
    )
    .digest("hex");

describe("native combat deployment clocks", () => {
  it("retains the pinned static trace separating combat readiness from visual delay", () => {
    expect(native.sha256).toBe(
      "c5c6b06925a422c5933614541adbb197605e189f8537de3c163217d118b14746",
    );
    expect(native.blocks.map((b) => b.name)).toEqual(
      expect.arrayContaining([
        "deployTimeLoader",
        "deployDelayLoader",
        "enterDeployState",
        "visualGroupDelay",
        "visualDelaySetter",
        "visualDelayGate",
      ]),
    );
    expect(native.visualHook).toEqual({
      vtable: "0x7a9b30",
      slot: "0x68",
      target: "0x870e0",
    });
    const block = (name: string) => native.blocks.find((b) => b.name === name)!;
    expect(block("deployTimeLoader").instructions.join("\n")).toContain(
      "[edi+0x200]",
    );
    expect(block("deployDelayLoader").instructions.join("\n")).toContain(
      "[edi+0x2a8]",
    );
    expect(block("visualDelaySetter").instructions.join("\n")).toContain(
      "[esi+0x530]",
    );
    expect(block("enterDeployState").instructions.join("\n")).toContain(
      "1dec0a",
    );
  });

  for (const team of ["blue", "red"] as const) {
    it.each(cards)(
      "makes %s combat-ready after one second on the " + team + " side",
      (card) => {
        const current = scene(card, team, 18);
        const previous = scene(card, team, 17);
        const units = current.entities.filter((e) => e.card === card);
        const oldUnits = previous.entities.filter((e) => e.card === card);
        expect(units.length).toBeGreaterThan(0);
        expect(units.every((e) => e.deploy === 1)).toBe(true);
        expect(oldUnits.every((e) => e.deploy === 1.4)).toBe(true);
        expect(deploymentTime(card)).toBe(1);
        expect(deploymentTime(card, 17)).toBe(1.4);
        for (let tick = 0; tick < Math.round(1.2 / STEP); tick++) {
          current.step();
          previous.step();
        }
        expect(units.every((e) => e.deploy <= 0 && e.move > 0)).toBe(true);
        expect(oldUnits.every((e) => e.deploy > 0 && e.move === 0)).toBe(true);
        const guest = perspective(snapshot(current), team);
        expect(
          guest.entities
            .filter((e) => units.some((u) => u.id === e.id))
            .every((e) => e.deploy <= 0),
        ).toBe(true);
      },
    );

    for (const version of [17, 18] as const) {
      it.each(["furnace", "barbarian-hut"] as const)(
        `uses the preserved/current troop timer in %s ${team} waves under rules ${version}`,
        (card) => {
          const battle = scene(card, team, version);
          const troop = card === "furnace" ? "fire-spirits" : "barbarians";
          const seen = new Set<number>();
          for (let tick = 0; tick < 600 && seen.size < 2; tick++) {
            battle.step();
            for (const unit of battle.entities.filter(
              (e) => e.card === troop,
            )) {
              if (seen.has(unit.id)) continue;
              seen.add(unit.id);
              expect(unit.deploy).toBeCloseTo(version === 18 ? 1 : 1.4, 8);
            }
          }
          expect(seen.size).toBe(2);
        },
      );
      it(`uses the rules ${version} timer for summoned and death-spawned ${team} Bats`, () => {
        const battle = scene("night-witch", team, version);
        const witch = battle.entities.at(-1)!;
        Object.assign(witch, { deploy: 0, speed: 0, spawnTimer: 0 });
        battle.step();
        const bats = battle.entities.filter((e) => e.card === "bats");
        expect(bats).toHaveLength(2);
        expect(bats.every((e) => e.deploy === (version === 18 ? 1 : 1.4))).toBe(
          true,
        );
        (battle as any).hurt(witch, witch.hp);
        const deathBats = battle.entities.filter(
          (e) => e.card === "bats" && !bats.includes(e),
        );
        expect(deathBats).toHaveLength(4);
        expect(
          deathBats.every((e) => e.deploy === (version === 18 ? 1 : 1.4)),
        ).toBe(true);
      });
    }
  }

  it("retains ordinary, siege and slow tank deployment times", () => {
    for (const version of [17, 18]) {
      expect(deploymentTime("three-musketeers", version)).toBe(1);
      expect(deploymentTime("knight", version)).toBe(1);
      expect(deploymentTime("golem", version)).toBe(3);
      expect(deploymentTime("mortar", version)).toBe(4);
      expect(deploymentTime("x-bow", version)).toBe(4);
    }
  });
});

it("reproduces all captured deployment match checkpoints for origin rules 1–17", () => {
  expect(golden.sourceCommit).toBe("ba6d20c");
  expect(golden.cases).toHaveLength(17);
  for (const row of golden.cases) {
    const battle = new Battle({ replay: row.replay as Replay });
    for (const checkpoint of row.checkpoints) {
      while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
      expect(
        digest(battle),
        `version ${row.replay.version}, tick ${checkpoint.tick}`,
      ).toBe(checkpoint.digest);
    }
  }
}, 30000);

it("replays a complete current match with corrected troop and summon clocks", () => {
  const source = golden.cases.at(-1)!.replay;
  const battle = new Battle({
    replay: { ...source, version: 18, actions: [], duration: 12000 } as Replay,
  });
  const checkpoints: { tick: number; digest: string }[] = [];
  for (let tick = 0; tick < 12000 && !battle.winner; tick++) {
    for (const action of source.actions.filter((a) => a.tick === battle.tick)) {
      const team = action.team as Team;
      const slot = battle.players[team].hand.indexOf(action.card as CardId);
      if (slot >= 0) battle.play(team, slot, action.x, action.y);
    }
    battle.step();
    if (battle.tick % 300 === 0 || battle.winner)
      checkpoints.push({ tick: battle.tick, digest: digest(battle) });
  }
  expect(battle.winner).toBeTruthy();
  expect(battle.exportReplay().version).toBe(18);
  const replay = new Battle({ replay: battle.exportReplay() });
  for (const checkpoint of checkpoints) {
    while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
    expect(digest(replay), `current tick ${checkpoint.tick}`).toBe(
      checkpoint.digest,
    );
  }
});
