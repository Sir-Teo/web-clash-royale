import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARDS, CARD_MAP } from "../src/game/cards";
import type { CardId } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import type { Replay } from "../src/game/engine";
import radii from "../src/game/archived-collision-radii.json" with { type: "json" };

const table = (name: string) => Object.fromEntries(
  csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
  .portraits as Record<string, { table: string; row: string }>;
const troopSpells = table("spells_characters");
const buildingSpells = table("spells_buildings");
const characters = table("characters");
const buildings = table("buildings");

describe("archived collision radii", () => {
  it("pins every troop, building and tower's source collision bound", () => {
    const ids = CARDS.filter((card) => card.kind !== "spell")
      .map((card) => card.id).concat("golemite", "lava-pup").sort();
    expect(Object.keys(radii.cards).sort()).toEqual(ids);
    for (const id of ids) {
      const portrait = portraits[id];
      const source = id === "golemite" ? characters.Golemite :
        id === "lava-pup" ? characters.LavaPups :
        portrait.table === "spells_characters"
          ? characters[troopSpells[portrait.row].SummonCharacter]
          : buildings[buildingSpells[portrait.row].SummonCharacter];
      expect(radii.cards[id as keyof typeof radii.cards], id).toBe(
        Number(source.CollisionRadius) / 1000,
      );
    }
    expect(radii.towers).toEqual({
      king: Number(buildings.KingTower.CollisionRadius) / 1000,
      princess: Number(buildings.PrincessTower.CollisionRadius) / 1000,
    });
  });

  it("changes live attack reach while replay versions 1–14 keep prior bounds", () => {
    const base = new Battle({ seed: 151, ai: false });
    for (const version of [1, 14, 15, 16] as const) {
      const battle = version === 16 ? base : new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      expect(battle.entities.filter((e) => e.king).map((e) => e.radius)).toEqual(
        version >= 15 ? [1.4, 1.4] : [1.25, 1.25],
      );
      expect(battle.entities.filter((e) => e.kind === "tower" && !e.king)
        .map((e) => e.radius)).toEqual(Array(4).fill(version >= 15 ? 1 : 1.05));
      for (const id of ["knight", "skeleton-army", "giant-skeleton", "sparky",
        "tesla", "goblin-hut"] as CardId[]) {
        const sample = new Battle({ replay: {
          ...base.exportReplay(), version,
        } as Replay });
        sample.players.blue.hand[0] = id;
        sample.players.blue.elixir = 10;
        expect(sample.play("blue", 0, 4, 22).ok, `${id} v${version}`).toBe(true);
        const troop = sample.entities.find((e) => e.card === id)!;
        const card = CARD_MAP[id];
        const legacy = card.kind === "building" ? 0.8 :
          troop.hp > 3000 ? 0.55 : card.count > 2 ? 0.25 : 0.37;
        expect(troop.radius, `${id} v${version}`).toBe(
          version >= 15 ? radii.cards[id as keyof typeof radii.cards] : legacy,
        );
      }
      for (const tower of battle.entities) tower.active = false;
      battle.players.blue.hand[0] = "knight";
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
      const attacker = battle.entities.find((e) => e.card === "knight")!;
      Object.assign(attacker, { x: 9, y: 21, deploy: 0, cooldown: 0 });
      battle.players.red.hand[0] = "giant-skeleton";
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
      const defender = battle.entities.find((e) => e.card === "giant-skeleton")!;
      Object.assign(defender, { x: 9, y: 19.2, deploy: 0, active: false });
      battle.step();
      expect(!!attacker.pendingAttack, `attack reach v${version}`).toBe(
        version >= 15,
      );
    }
  });
});
