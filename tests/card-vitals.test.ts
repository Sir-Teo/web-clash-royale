import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARD_MAP, LEGACY_CARD_VITALS } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import type { Replay } from "../src/game/engine";

const table = (name: string) => Object.fromEntries(
  csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const factors = {
  Common: { hp: 1666 / 660, damage: 202 / 75 },
  Rare: { hp: 720 / 340, damage: 218 / 100 },
  Epic: { hp: 1.1 ** 5, damage: 1.1 ** 5 },
  Legendary: { hp: 1.1 ** 2, damage: 1.1 ** 2 },
};

describe("source-normalized troop vitals", () => {
  it("derives each corrected health or damage value from the pinned unit or projectile row", () => {
    const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
      .portraits as Record<string, { table: string; row: string }>;
    const spells = table("spells_characters");
    const characters = table("characters");
    const projectiles = table("projectiles");
    const projected = JSON.parse(readFileSync("src/game/archived-card-vitals.json", "utf8")) as
      Record<string, Partial<{ hp: number; damage: number }>>;
    expect(Object.keys(projected).sort()).toEqual([
      "baby-dragon", "bomber", "goblin-gang", "goblins", "mini-pekka",
      "pekka", "prince", "spear-goblins", "witch",
    ]);
    for (const [id, stats] of Object.entries(projected)) {
      const spell = spells[portraits[id].row];
      const source = characters[spell.SummonCharacter];
      const scale = factors[spell.Rarity as keyof typeof factors];
      if (stats.hp !== undefined) {
        const expected = Math.round(Number(source.Hitpoints) * scale.hp);
        expect(stats.hp, `${id} hp`).toBe(expected);
        expect(CARD_MAP[id as CardId].hp).toBe(expected);
      }
      if (stats.damage !== undefined) {
        const raw = Number(source.Damage) || Number(projectiles[source.Projectile].Damage);
        const expected = Math.round(raw * scale.damage);
        expect(stats.damage, `${id} damage`).toBe(expected);
        expect(CARD_MAP[id as CardId].damage).toBe(expected);
      }
    }
  });

  it("spawns version-9 values and retains version-8 health and damage in old replays", () => {
    const base = new Battle({ seed: 97, ai: false });
    for (const version of [8, 9] as const) {
      const battle = version === 9 ? base : new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      for (const id of ["mini-pekka", "bomber", "baby-dragon", "prince",
        "pekka", "goblins", "spear-goblins", "witch"] as CardId[]) {
        battle.players.blue.hand[0] = id;
        battle.players.blue.elixir = 10;
        expect(battle.play("blue", 0, 4, 22).ok, `${id} v${version}`).toBe(true);
        const unit = battle.entities.findLast((entity) => entity.card === id)!;
        const stats = version === 9 ? CARD_MAP[id] : LEGACY_CARD_VITALS[id]!;
        expect(unit.hp).toBe(stats.hp ?? CARD_MAP[id].hp);
        expect(unit.maxHp).toBe(stats.hp ?? CARD_MAP[id].hp);
        expect(unit.damage).toBe(stats.damage ?? CARD_MAP[id].damage);
      }
    }
  });
});
