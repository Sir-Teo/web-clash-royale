import type { Entity, Team } from "./engine";
import native from "./tower-layout-data.json" with { type: "json" };

export interface TowerSite {
  team: Team;
  x: number;
  y: number;
  king: boolean;
  lane?: "left" | "right";
}
// Stable order also preserves the tower IDs in archived replays.
export const TOWER_SITES: readonly TowerSite[] = (
  ["red", "blue"] as Team[]
).flatMap((team) => [
  {
    team,
    x: 4,
    y: team === "blue" ? 26 : 6,
    king: false,
    lane: "left" as const,
  },
  {
    team,
    x: 14,
    y: team === "blue" ? 26 : 6,
    king: false,
    lane: "right" as const,
  },
  { team, x: 9, y: team === "blue" ? 29.5 : 2.5, king: true },
]);
export const NATIVE_TOWER_SITES: readonly TowerSite[] =
  native.sites as TowerSite[];

/** The legacy constant remains stable for historical and local recordings. */
export const towerSites = (nativeLayout?: true) =>
  nativeLayout ? NATIVE_TOWER_SITES : TOWER_SITES;

export function destroyedTowerSites(
  entities: readonly Entity[],
  nativeLayout?: true,
) {
  return towerSites(nativeLayout).filter(
    (site) =>
      !entities.some(
        (e) =>
          e.kind === "tower" &&
          e.hp > 0 &&
          e.team === site.team &&
          e.x === site.x &&
          e.y === site.y,
      ),
  );
}
