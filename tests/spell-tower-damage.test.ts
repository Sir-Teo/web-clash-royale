import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARD_MAP } from "../src/game/cards";
import { Battle, STEP } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import type { Replay } from "../src/game/engine";

const table = (name: string) => Object.fromEntries(
  csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
  .portraits as Record<string, { row: string }>;
const spells = table("spells_other");
const projectiles = table("projectiles");
const areas = table("area_effect_objects");

describe("archived spell damage to Crown Towers", () => {
  it("reads the same 40% fraction from Fireball, Arrows, Rocket and Zap source rows", () => {
    for (const id of ["fireball", "arrows", "rocket", "zap"] as CardId[]) {
      const source = spells[portraits[id].row];
      const effect = id === "zap"
        ? areas[source.AreaEffectObject]
        : projectiles[source.CustomFirstProjectile || source.Projectile];
      expect(1 + Number(effect.CrownTowerDamagePercent) / 100, id).toBe(0.4);
    }
  });

  it("uses 40% in new battles and retains 30% for the first three spells in v11 replays", () => {
    const base = new Battle({ seed: 83, ai: false });
    for (const version of [11, 12, 13, 14, 15, 16] as const) {
      for (const id of ["fireball", "arrows", "zap"] as CardId[]) {
        const battle = version === 16
          ? new Battle({ seed: 83, ai: false })
          : new Battle({ replay: { ...base.exportReplay(), version } as Replay });
        const tower = battle.entities.find((entity) =>
          entity.team === "red" && entity.kind === "tower" &&
          !entity.king && entity.lane === "left",
        )!;
        for (const entity of battle.entities) entity.active = false;
        battle.players.blue.hand[0] = id;
        battle.players.blue.elixir = 10;
        const hp = tower.hp;
        expect(battle.play("blue", 0, tower.x, tower.y).ok).toBe(true);
        expect(battle.projectiles.every((p) =>
          p.towerDamageFraction === (version >= 12 ? 0.4 : undefined),
        ), `${id} v${version}`).toBe(true);
        for (let i = 0; i < 4 / STEP; i++) battle.step();
        expect(tower.hp, `${id} v${version}`).toBeCloseTo(
          hp - CARD_MAP[id].damage * (version >= 12 ? 0.4 : 0.3),
        );
      }
    }
  });
});
