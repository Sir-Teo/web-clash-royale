import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CARD_MAP } from "../src/game/cards";
import { entityProjectileStartHeight, entityVisualHeight, projectileHitHeight } from "../src/game/engine";
import type { CardId } from "../src/game/cards";
import heights from "../src/game/flight-heights.json";
import manifest from "../reference/client/flight-heights-manifest.json";

it("uses the archived height and muzzle offset for every flying character", () => {
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  expect(hash(manifest.input.path)).toBe(manifest.input.sha256);
  expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
  const expected = [
    ["minions", "Minion", 1.5, 0.45],
    ["minion-horde", "Minion", 1.5, 0.45],
    ["mega-minion", "MegaMinion", 1.5, 0.45],
    ["bats", "Bat", 2, 0.35],
    ["balloon", "Balloon", 3, 0.45],
    ["baby-dragon", "BabyDragon", 3.5, 1.9],
    ["inferno-dragon", "InfernoDragon", 4, 0.45],
    ["lava-hound", "LavaHound", 5, 1.8],
    ["lava-pup", "LavaPups", 3.5, 0.1],
  ] as const;
  expect(Object.keys(heights)).toHaveLength(expected.length);
  for (const [id, source, flyingHeight, projectileStartZ] of expected) {
    const card = CARD_MAP[id as CardId];
    expect(card.air).toBe(true);
    expect(heights[id]).toEqual({ source, flyingHeight, projectileStartZ });
    const entity = { card: id as CardId, air: true, kind: "troop" as const };
    expect(entityVisualHeight(entity)).toBe(flyingHeight);
    expect(entityProjectileStartHeight(entity)).toBe(flyingHeight + projectileStartZ);
    expect(projectileHitHeight(entity)).toBeCloseTo(flyingHeight + 0.1);
  }
});
