import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Battle,
  STEP,
  type Entity,
  type Replay,
  type Team,
} from "../src/game/engine";
import { cardDetails } from "../src/ui/card-details";
import { createKingDefense } from "../src/game/king-defense";
import source from "../src/game/balloon-bomb-data.json";
import golden from "./fixtures/balloon-bomb-rules19-golden.json";

const rows = () =>
  Object.fromEntries(
    cardDetails("balloon").stats.map((row) => [row.label, row.value]),
  );
const digest = (battle: Battle) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          golden.stateFields.map((key) => [key, (battle as any)[key]]),
        ),
      ),
    )
    .digest("hex");
function setup(
  team: Team = "blue",
  version: Replay["version"] = 20,
  rulesFamily: "origin" | "local" = "origin",
) {
  const initial = new Battle({ seed: 91, ai: false });
  const battle = new Battle({
    replay: { ...initial.exportReplay(), version, rulesFamily },
  });
  for (const body of battle.entities) body.active = false;
  battle.players[team].hand[0] = "balloon";
  battle.players[team].elixir = 10;
  expect(battle.play(team, 0, 4, team === "blue" ? 22 : 10).ok).toBe(true);
  const balloon = battle.entities.find((e) => e.card === "balloon")!;
  const drop = () => {
    (battle as any).hurt(balloon, balloon.hp);
    return battle.projectiles.find((p) => p.style === "bomb")!;
  };
  return { battle, balloon, drop };
}

describe("source-backed Balloon death bomb", () => {
  it("pins the archived tables, original drop animation and normalized blast values", () => {
    const manifest = JSON.parse(
      readFileSync("reference/client/balloon-bomb-manifest.json", "utf8"),
    );
    for (const input of [...manifest.inputs, manifest.output])
      expect(
        createHash("sha256").update(readFileSync(input.path)).digest("hex"),
      ).toBe(input.sha256);
    expect(source.bomb).toMatchObject({
      source: "BalloonBomb",
      sourceDamage: 205,
      delay: 1,
      radius: 3,
      hitsAir: true,
      hitsGround: true,
    });
    expect(rows()).toMatchObject({
      "Death bomb damage": "330",
      "Bomb delay": "1 s",
      "Bomb radius": "3 tiles",
      "Bomb targets": "Air & ground",
      Targets: "Buildings",
    });
    expect(rows()).not.toHaveProperty("Bomb knockback");
    expect(rows()["Damage per hit"]).not.toBe(rows()["Death bomb damage"]);
    expect(cardDetails("balloon").note).toContain(
      "normal attack targets buildings",
    );
    const art = JSON.parse(
      readFileSync("public/assets/effects/effects.json", "utf8"),
    );
    for (const team of ["blue", "red"]) {
      const clip = art.clips[`balloon_bomb_${team}`];
      expect(clip.labels.attack_end / clip.fps).toBe(source.bomb.delay);
    }
  });
  it.each(["blue", "red"] as const)(
    "matches displayed damage, delay, radius and targeting to actual detonation (%s)",
    (team) => {
      const stats = rows();
      for (const kind of [
        "ground",
        "air",
        "tower",
        "ally",
        "outside",
        "shield",
      ] as const) {
        const { battle, balloon, drop } = setup(team);
        const enemy = team === "blue" ? "red" : "blue";
        const side = kind === "ally" ? team : enemy;
        let target: Entity;
        if (kind === "tower")
          target = battle.entities.find(
            (e) => e.kind === "tower" && e.team === enemy && !e.king,
          )!;
        else {
          const card =
            kind === "air"
              ? "mega-minion"
              : kind === "shield"
                ? "dark-prince"
                : "knight";
          battle.players[side].hand[0] = card;
          battle.players[side].elixir = 10;
          expect(battle.play(side, 0, 4, side === "blue" ? 22 : 10).ok).toBe(
            true,
          );
          target = battle.entities
            .filter((e) => e.card === card && e.team === side)
            .at(-1)!;
        }
        const offset =
          kind === "ground" || kind === "outside"
            ? parseFloat(stats["Bomb radius"]) +
              target.radius +
              (kind === "outside" ? 0.05 : -0.05)
            : 2;
        Object.assign(target, {
          x: balloon.x + offset,
          y: balloon.y,
          hp: 10000,
          maxHp: 10000,
          deploy: 0,
          active: false,
          speed: 0,
        });
        const start = { x: target.x, y: target.y };
        const bomb = drop();
        expect(bomb).toMatchObject({
          damage: 330,
          remaining: 1,
          duration: 1,
          splash: 3,
          air: true,
        });
        const ticks = Math.round(parseFloat(stats["Bomb delay"]) / STEP);
        for (let tick = 1; tick < ticks; tick++) battle.step();
        expect(target.hp).toBe(10000);
        expect(battle.projectiles).toContain(bomb);
        battle.step();
        expect(battle.projectiles).not.toContain(bomb);
        expect(10000 - target.hp).toBe(
          ["ally", "outside", "shield"].includes(kind)
            ? 0
            : Number(stats["Death bomb damage"]),
        );
        if (kind === "shield") expect(target.shield).toBe(0);
        expect({ x: target.x, y: target.y }).toEqual(start);
      }
    },
  );
  it("keeps the exact previous packet in every origin rules version through 19", () => {
    for (let version = 1; version <= 19; version++)
      expect(setup("blue", version as Replay["version"]).drop()).toMatchObject({
        damage: 240,
        remaining: 0.8,
        duration: 0.8,
        splash: 2.2,
        air: false,
      });
  });
  it("keeps the frozen local bomb in every supported local version", () => {
    for (const version of [1, 2, 3, 4, 5] as const)
      expect(setup("blue", version, "local").drop()).toMatchObject({
        damage: 240,
        remaining: 0.8,
        duration: 0.8,
        splash: 2.2,
        air: false,
      });
  });
  it.each([19, 20] as const)(
    "released King-damage forecasting follows the actual version-%i packet",
    (version) => {
      const { battle, balloon, drop } = setup("blue", version);
      const king = battle.entities.find((e) => e.team === "red" && e.king)!;
      king.hp = 300;
      Object.assign(balloon, { x: king.x, y: king.y + 1 });
      drop();
      const forecast = createKingDefense(
        "red",
        battle.entities,
        battle.projectiles,
        battle.areas,
      );
      expect(forecast.baseline).toBe(version === 20 ? 30 : Infinity);
      expect(forecast.evaluate("freeze", balloon).improves).toBe(false);
      for (let tick = 0; tick < 29; tick++) battle.step();
      if (version === 20) expect(king.hp).toBe(300);
      battle.step();
      expect(king.hp).toBe(version === 20 ? 0 : 60);
      expect(battle.winner).toBe(version === 20 ? "blue" : null);
    },
  );
  it("preserves complete pre-change rules-19 matches, including death packets and RNG", () => {
    expect(golden.sourceCommit).toBe("42e13dc");
    for (const row of golden.cases) {
      expect(row.deaths).toBeGreaterThan(0);
      const battle = new Battle({ replay: row.replay as Replay });
      for (const checkpoint of row.checkpoints) {
        while (battle.tick < checkpoint.tick && !battle.winner) battle.step();
        expect(
          digest(battle),
          `seed ${row.replay.seed} tick ${checkpoint.tick}`,
        ).toBe(checkpoint.digest);
      }
    }
  });
  it("records and replays a complete rules-20 match through Balloon deaths", () => {
    const old = golden.cases[0].replay as Replay;
    const battle = new Battle({
      replay: { ...old, version: 20, actions: [], duration: 9000 },
    });
    const checkpoints: { tick: number; digest: string }[] = [];
    while (!battle.winner && battle.tick < 9000) {
      for (const action of old.actions.filter((a) => a.tick === battle.tick)) {
        const slot = battle.players[action.team].hand.indexOf(action.card);
        if (slot >= 0) battle.play(action.team, slot, action.x, action.y);
      }
      battle.step();
      if (battle.tick % 600 === 0 || battle.winner)
        checkpoints.push({ tick: battle.tick, digest: digest(battle) });
    }
    expect(battle.winner).toBeTruthy();
    expect(
      battle.audioEvents.some(
        (e) => e.profile === "balloon" && e.phase === "death-impact",
      ),
    ).toBe(true);
    const record = battle.exportReplay();
    expect(record.version).toBe(20);
    const replay = new Battle({ replay: record });
    for (const checkpoint of checkpoints) {
      while (replay.tick < checkpoint.tick && !replay.winner) replay.step();
      expect(digest(replay), `current tick ${checkpoint.tick}`).toBe(
        checkpoint.digest,
      );
    }
  });
});
