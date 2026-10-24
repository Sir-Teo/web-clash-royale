import { CARD_MAP } from "./cards";
import type { CardId } from "./cards";
import type { Point } from "./engine";
import type { Team } from "./engine";
import goblinGang from "./goblin-gang-data.json" with { type: "json" };
import bats from "./bats-data.json" with { type: "json" };
import eliteBarbarians from "./elite-barbarians-data.json" with { type: "json" };
import fireSpirits from "./fire-spirits-data.json" with { type: "json" };
import guards from "./guards-data.json" with { type: "json" };

export function deploymentPositions(
  id: CardId,
  point: Point,
  team: Team = "blue",
  countOverride?: number,
): Point[] {
  if (id === "barbarians") {
    const forward = team === "blue" ? -1 : 1;
    return Array.from({ length: 4 }, (_, i) => ({
      x: Math.max(0.6, Math.min(17.4, point.x + (i % 2 === 0 ? -0.55 : 0.55))),
      y: Math.max(
        0.8,
        Math.min(31.2, point.y + (i < 2 ? forward : -forward) * 0.48),
      ),
    }));
  }
  if (id === "elite-barbarians") {
    return [-1, 1].map((side) => ({
      x: Math.max(0.6, Math.min(17.4, point.x + side * eliteBarbarians.summonRadius)),
      y: Math.max(0.8, Math.min(31.2, point.y)),
    }));
  }
  if (id === "fire-spirits") {
    const forward = team === "blue" ? -1 : 1;
    return [
      { x: -0.55, y: -forward * 0.25 },
      { x: 0, y: forward * fireSpirits.sourceSpawnRadius },
      { x: 0.55, y: -forward * 0.25 },
    ].map((offset) => ({
      x: Math.max(0.6, Math.min(17.4, point.x + offset.x)),
      y: Math.max(0.8, Math.min(31.2, point.y + offset.y)),
    }));
  }
  if (id === "guards") {
    const forward = team === "blue" ? -1 : 1;
    return [
      { x: -guards.summonRadius, y: 0 },
      { x: guards.summonRadius, y: 0 },
      { x: 0, y: forward * guards.summonRadius },
    ].map((offset) => ({
      x: Math.max(0.6, Math.min(17.4, point.x + offset.x)),
      y: Math.max(0.8, Math.min(31.2, point.y + offset.y)),
    }));
  }
  if (id === "goblin-gang") {
    const forward = team === "blue" ? -1 : 1;
    const width = Math.sqrt(goblinGang.radius ** 2 - 0.35 ** 2);
    return Array.from({ length: goblinGang.count }, (_, i) => ({
      x: Math.max(0.6, Math.min(17.4, point.x + ((i % 3) - 1) * width)),
      y: Math.max(
        0.8,
        Math.min(31.2, point.y + (i < 3 ? forward : -forward) * 0.35),
      ),
    }));
  }
  if (id === "bats") {
    return Array.from({ length: bats.count }, (_, i) => {
      const angle = i * 2.39996;
      const spread = Math.sqrt(i / (bats.count - 1)) * bats.summonRadius;
      return {
        x: Math.max(0.6, Math.min(17.4, point.x + Math.cos(angle) * spread)),
        y: Math.max(0.8, Math.min(31.2, point.y + Math.sin(angle) * spread)),
      };
    });
  }
  const count = countOverride ?? CARD_MAP[id].count;
  return Array.from({ length: count }, (_, i) => {
    const angle = i * 2.39996,
      spread = count === 1 ? 0 : Math.sqrt(i) * 0.43;
    return {
      x: Math.max(0.6, Math.min(17.4, point.x + Math.cos(angle) * spread)),
      y: Math.max(0.8, Math.min(31.2, point.y + Math.sin(angle) * spread)),
    };
  });
}
