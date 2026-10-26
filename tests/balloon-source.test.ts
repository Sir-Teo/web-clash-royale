import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARD_MAP, LEGACY_BALLOON_STATS } from "../src/game/cards";
import { Battle, STEP } from "../src/game/engine";
import type { Replay } from "../src/game/engine";

const source = csvRows(readFileSync("reference/logic/characters.csv", "utf8"))
  .find((row) => row.Name === "Balloon")!;

describe("archived Balloon main attack", () => {
  it("uses the source movement speed, bomb damage, reach and three-second hit interval", () => {
    expect(CARD_MAP.balloon).toMatchObject({
      speed: Number(source.Speed) / 60,
      damage: Math.round(Number(source.Damage) * 1.1 ** 5),
      range: Number(source.Range) / 1000,
      interval: Number(source.HitSpeed) / 1000,
    });
  });

  it("keeps the previous Balloon attack in version-9 replays", () => {
    const base = new Battle({ seed: 67, ai: false });
    for (const version of [9, 10, 11, 12, 13, 14, 15, 16] as const) {
      const battle = new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      battle.players.blue.hand[0] = "balloon";
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
      const balloon = battle.entities.find((entity) => entity.card === "balloon")!;
      const stats = version >= 10 ? CARD_MAP.balloon : LEGACY_BALLOON_STATS;
      expect(balloon).toMatchObject({
        damage: stats.damage, range: stats.range, interval: stats.interval,
      });
      const tower = battle.entities.find((entity) =>
        entity.kind === "tower" && entity.team === "red" && !entity.king &&
        entity.x === 4,
      )!;
      for (const entity of battle.entities)
        if (entity.kind === "tower") entity.active = false;
      Object.assign(balloon, {
        x: tower.x, y: tower.y + 1.5, deploy: 0, cooldown: 0,
      });
      battle.step();
      if (version === 9) expect(balloon.pendingAttack).toBeDefined();
      else expect(balloon.pendingAttack).toBeUndefined();
    }
  });

  it("keeps the old flight speed through version 12 and moves at the source speed in new matches", () => {
    const base = new Battle({ seed: 68, ai: false });
    for (const version of [6, 7, 10, 12, 13, 14, 15, 16] as const) {
      const battle = new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      battle.players.blue.hand[0] = "balloon";
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
      const balloon = battle.entities.find((entity) => entity.card === "balloon")!;
      const speed = version >= 13 ? Number(source.Speed) / 60 : 0.85;
      expect(balloon.speed).toBe(speed);
      balloon.deploy = 0;
      const startY = balloon.y;
      for (let i = 0; i < 1 / STEP; i++) battle.step();
      expect(startY - balloon.y, `movement in v${version}`).toBeCloseTo(speed);
    }
  });
});
