/** Combat area streams must reproduce without replaying AI random draws. */
export const areaRandomSeed = (seed: number, id: number) =>
  (seed ^ Math.imul(id, 0x9e3779b9)) >>> 0;

export function areaRandom(area: { spawnRandomState?: number }, seed: number) {
  area.spawnRandomState =
    (Math.imul(1664525, area.spawnRandomState ?? seed) + 1013904223) >>> 0;
  return area.spawnRandomState / 4294967296;
}
