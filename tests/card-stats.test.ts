import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARD_MAP, LEGACY_BUILDING_STATS, LEGACY_CARD_STATS } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import type { CardId, Card } from "../src/game/cards";
import type { Replay } from "../src/game/engine";

const rows = (name: string) => Object.fromEntries(
  csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);

describe("archived basic troop movement and attack stats", () => {
  it("projects every direct character's speed, reach, and cadence from the pinned CSVs", () => {
    const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
      .portraits as Record<string, { table: string; row: string }>;
    const spells = rows("spells_characters");
    const characters = rows("characters");
    const projected = JSON.parse(readFileSync("src/game/archived-card-stats.json", "utf8")) as
      Record<string, Pick<Card, "speed" | "range" | "interval">>;
    const ids = Object.entries(portraits)
      .filter(([id, portrait]) => portrait.table === "spells_characters" &&
        id !== "executioner")
      .map(([id]) => id).sort();
    expect(Object.keys(projected).sort()).toEqual(ids);
    for (const id of ids) {
      const source = characters[spells[portraits[id].row].SummonCharacter];
      const expected = {
        speed: Number(source.Speed) / 60,
        range: Number(source.Range) / 1000,
        interval: Number(source.HitSpeed) / 1000,
      };
      expect(projected[id], id).toEqual(expected);
      expect(CARD_MAP[id as CardId], id).toMatchObject(expected);
    }
  });

  it("uses new stats in live matches while preserving the old combat values in v6 replays", () => {
    const cards: CardId[] = ["knight", "archers", "giant", "goblins"];
    const original = new Battle({ seed: 43, ai: false });
    const previous = new Battle({ replay: {
      ...original.exportReplay(), version: 6,
    } as Replay });
    expect(original.rulesVersion).toBe(51);
    expect(previous.rulesVersion).toBe(6);
    for (const battle of [original, previous]) {
      for (const id of cards) {
        battle.players.blue.hand[0] = id;
        battle.players.blue.elixir = 10;
        expect(battle.play("blue", 0, 4, 22).ok, `${id} v${battle.rulesVersion}`).toBe(true);
        const unit = battle.entities.findLast((entity) => entity.card === id)!;
        const stats = battle.rulesVersion >= 7 ? CARD_MAP[id] : LEGACY_CARD_STATS[id]!;
        expect(unit, `${id} v${battle.rulesVersion}`).toMatchObject({
          speed: stats.speed, range: stats.range, interval: stats.interval,
        });
      }
    }
  });

  it("matches the archived reach, attack interval, and lifetime of attacking buildings", () => {
    const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
      .portraits as Record<string, { table: string; row: string }>;
    const spells = rows("spells_buildings");
    const buildings = rows("buildings");
    for (const id of ["cannon", "tesla", "mortar", "bomb-tower", "inferno-tower", "x-bow"] as CardId[]) {
      const portrait = portraits[id];
      const source = buildings[spells[portrait.row].SummonCharacter];
      expect(CARD_MAP[id], id).toMatchObject({
        range: Number(source.Range) / 1000,
        interval: Number(source.HitSpeed) / 1000,
        lifetime: Number(source.LifeTime) / 1000,
      });
    }
  });

  it("keeps Cannon and Tesla cadence and Tesla lifetime unchanged in version-7 replays", () => {
    const base = new Battle({ seed: 91, ai: false });
    for (const version of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const) {
      const battle = version === 16 ? base : new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      for (const id of ["cannon", "tesla"] as CardId[]) {
        battle.players.blue.hand[0] = id;
        battle.players.blue.elixir = 10;
        expect(battle.play("blue", 0, id === "cannon" ? 4 : 7, 22).ok).toBe(true);
        const unit = battle.entities.find((entity) => entity.card === id)!;
        const stats = version >= 8 ? CARD_MAP[id] : LEGACY_BUILDING_STATS[id]!;
        expect(unit.interval, `${id} v${version}`).toBe(stats.interval);
        expect(unit.lifetime, `${id} v${version}`).toBe(
          stats.lifetime ?? CARD_MAP[id].lifetime,
        );
      }
    }
  });
});
