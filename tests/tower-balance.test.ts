import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvRows } from "../scripts/lib/csv.mjs";
import { Battle } from "../src/game/engine";
import type { Replay } from "../src/game/engine";

const buildings = Object.fromEntries(
  csvRows(readFileSync("reference/logic/buildings.csv", "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);
const projectiles = Object.fromEntries(
  csvRows(readFileSync("reference/logic/projectiles.csv", "utf8"))
    .filter((row) => row.Name)
    .map((row) => [row.Name, row]),
);

describe("source-normalized Crown Tower health", () => {
  it("applies one health and projectile scale to both current tower types", () => {
    const battle = new Battle({ seed: 71, ai: false });
    const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
    const princess = battle.entities.find((e) =>
      e.team === "blue" && e.kind === "tower" && !e.king,
    )!;
    const sourceKing = buildings.KingTower;
    const sourcePrincess = buildings.PrincessTower;
    const scale = princess.maxHp / Number(sourcePrincess.Hitpoints);
    expect(scale).toBe(king.damage /
      Number(projectiles[sourceKing.Projectile].Damage));
    expect(princess.damage /
      Number(projectiles[sourcePrincess.Projectile].Damage)).toBe(scale);
    expect(king.maxHp).toBe(Math.round(Number(sourceKing.Hitpoints) * scale));
    expect(king.hp).toBe(king.maxHp);
  });

  it("retains the old King health in version-10 recordings", () => {
    const current = new Battle({ seed: 71, ai: false });
    const older = new Battle({ replay: {
      ...current.exportReplay(), version: 10,
    } as Replay });
    expect(current.rulesVersion).toBe(34);
    expect(current.entities.filter((e) => e.king).map((e) => e.maxHp))
      .toEqual([5232, 5232]);
    expect(older.entities.filter((e) => e.king).map((e) => e.maxHp))
      .toEqual([4824, 4824]);
  });
});
