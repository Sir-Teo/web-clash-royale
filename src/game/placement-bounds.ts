import type { Entity, Team } from "./engine";
import type { CardId } from "./cards";
import source from "./placement-bounds-data.json" with { type: "json" };

export type DeploymentYBounds = readonly [number, number];
type Footprint = {
  tileSize: number;
  noDeployWidth: number;
  noDeployHeight: number;
};
type Body = Pick<Entity, "card" | "kind" | "team" | "hp" | "x" | "y" | "king">;
// Absorb view-rotation noise far below one source unit before integer stores.
const coordinate = (tiles: number) => {
  const value = tiles * source.sourceUnitsPerTile,
    integer = Math.round(value);
  return Math.trunc(Math.abs(value - integer) <= 1e-7 ? integer : value);
};
/** Project the captured mask/column helper onto current browser bodies. */
export function deploymentYBounds(
  card: CardId,
  entities: readonly Body[],
  team: Team,
  x: number,
  viewMirrored?: true,
): DeploymentYBounds | undefined {
  const profile = (
    source.cards as Record<
      string,
      { flying: boolean; canDeployOnEnemySide: boolean }
    >
  )[card];
  if (!profile || profile.flying) return;
  const canonicalTeam = viewMirrored
    ? team === "blue"
      ? "red"
      : "blue"
    : team;
  const column = Math.trunc(
    coordinate(viewMirrored ? source.width - x : x) / 1000,
  );
  if (column < 0 || column >= source.width) return;
  const allowed = Array<boolean>(source.height).fill(true);
  for (const entity of entities) {
    if (entity.hp <= 0 || entity.kind === "troop") continue;
    const key =
      entity.card === "tower"
        ? entity.king
          ? "king"
          : "princess"
        : entity.card;
    const footprint = (source.bodies as Record<string, Footprint>)[key];
    if (!footprint) continue;
    const restricted =
      !profile.canDeployOnEnemySide &&
      entity.team !== team &&
      footprint.noDeployWidth > 0;
    const width = restricted ? footprint.noDeployWidth : footprint.tileSize;
    const height = restricted ? footprint.noDeployHeight : footprint.tileSize;
    const ex = coordinate(viewMirrored ? source.width - entity.x : entity.x);
    const ey = coordinate(viewMirrored ? source.height - entity.y : entity.y);
    const left = Math.trunc((ex - width * 500) / 1000),
      right = Math.trunc((ex + width * 500) / 1000);
    if (column < left || column >= right) continue;
    const top = Math.max(0, Math.trunc((ey - height * 500) / 1000));
    const bottom = Math.min(
      source.height,
      Math.trunc((ey + height * 500) / 1000),
    );
    for (let row = top; row < bottom; row++) allowed[row] = false;
  }
  const first = allowed.indexOf(true),
    last = allowed.lastIndexOf(true);
  if (first < 0) return;
  const lo = first * 1000 + (canonicalTeam === "blue" ? 499 : 0),
    hi = last * 1000 + (canonicalTeam === "red" ? 500 : 0);
  if (hi - lo >= source.height * 500) return;
  return viewMirrored
    ? [source.height - hi / 1000, source.height - lo / 1000]
    : [lo / 1000, hi / 1000];
}

export function clampDeploymentY(
  y: number,
  bounds?: DeploymentYBounds,
): number {
  return bounds ? Math.max(bounds[0], Math.min(bounds[1], y)) : y;
}
