import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { CARD_MAP, LEGACY_CARD_SPLASH } from "../src/game/cards";
import { Battle, STEP } from "../src/game/engine";
import type { Replay } from "../src/game/engine";

const table = (name: string) => Object.fromEntries(
  csvRows(readFileSync(`reference/logic/${name}.csv`, "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const portraits = JSON.parse(readFileSync("public/assets/ui/cards/cards.json", "utf8"))
  .portraits as Record<string, { row: string }>;
const spells = table("spells_characters");
const characters = table("characters");
const projectiles = table("projectiles");
const projected = JSON.parse(readFileSync("src/game/archived-card-splash.json", "utf8")) as
  Record<string, number>;
const cases = [
  { id: "valkyrie", secondary: 2.15, oldHits: false },
  { id: "bomber", secondary: 1.92, oldHits: true },
  { id: "baby-dragon", secondary: 1.72, oldHits: true },
  { id: "witch", secondary: 1.47, oldHits: true },
  { id: "wizard", secondary: 1.75, oldHits: true },
] as const;

describe("archived troop splash radii", () => {
  it("projects character melee or projectile area radii from pinned tables", () => {
    expect(Object.keys(projected).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const { id } of cases) {
      const character = characters[spells[portraits[id].row].SummonCharacter];
      const raw = Number(character.AreaDamageRadius) ||
        Number(projectiles[character.Projectile].Radius);
      expect(projected[id], id).toBe(raw / 1000);
      expect(CARD_MAP[id].splash, id).toBe(projected[id]);
    }
  });

  it.each(cases)("uses the new $id hit area while preserving legacy damage", ({
    id, secondary, oldHits,
  }) => {
    const base = new Battle({ seed: 143, ai: false });
    for (const version of [1, 13, 14] as const) {
      const battle = version === 14 ? base : new Battle({
        replay: { ...base.exportReplay(), version } as Replay,
      });
      for (const tower of battle.entities) tower.active = false;
      battle.players.blue.hand[0] = id;
      battle.players.blue.elixir = 10;
      expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
      const attacker = battle.entities.find((e) => e.card === id)!;
      Object.assign(attacker, { x: 9, y: 21, deploy: 0, cooldown: 0 });
      const defenders = [];
      for (let i = 0; i < 2; i++) {
        battle.players.red.hand[0] = "knight";
        battle.players.red.elixir = 10;
        expect(battle.play("red", 0, 4, 10).ok).toBe(true);
        defenders.push(battle.entities.findLast((e) =>
          e.card === "knight" && e.team === "red",
        )!);
      }
      const [primary, nearEdge] = defenders;
      Object.assign(primary, { x: 9, y: 20.5, deploy: 0, active: false });
      Object.assign(nearEdge, {
        x: 9 + secondary, y: id === "valkyrie" ? 21 : 20.5,
        deploy: 0, active: false,
      });
      let observedSplash: number | undefined;
      for (let i = 0; i < 4 / STEP && primary.hp === primary.maxHp; i++) {
        battle.step();
        observedSplash ??= battle.projectiles.find((p) =>
          p.source === attacker.id,
        )?.splash;
      }
      expect(primary.hp, `${id} primary v${version}`).toBeLessThan(primary.maxHp);
      expect(nearEdge.hp < nearEdge.maxHp, `${id} edge v${version}`).toBe(
        version < 14 ? oldHits : !oldHits,
      );
      if (id !== "valkyrie") expect(observedSplash).toBe(
        version < 14 ? LEGACY_CARD_SPLASH[id] : projected[id],
      );
    }
  });
});
