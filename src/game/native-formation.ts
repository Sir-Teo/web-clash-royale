import source from "./formation-data.json" with { type: "json" };

const integer = (value: number) => Math.trunc(value) | 0;
function sine(angle: number) {
  const degree = ((angle % 360) + 360) % 360;
  if (degree <= 90) return source.sineTable[degree];
  if (degree < 180) return source.sineTable[180 - degree];
  if (degree <= 270) return -source.sineTable[degree - 180];
  return -source.sineTable[360 - degree];
}
const scaleSine = (angle: number, radius: number) =>
  integer(Math.imul(sine(angle), radius) / 1024);

/** Integer offset math checked against the bounded native x86 fragment. */
export function nativeFormationOffset(
  index: number,
  count: number,
  radius: number,
  angleShift: number,
  flipY: boolean,
  lane: 0 | 1,
): { x: number; y: number } {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 180 ||
    index < 0 ||
    index >= count
  )
    throw new RangeError("Invalid native formation body index/count");
  if (count === 1 || (count === 7 && index === 0)) return { x: 0, y: 0 };
  let ring = count;
  if (count === 2) angleShift += 90;
  if (count === 3 || count === 5) angleShift += 180;
  if (count === 4) angleShift += 45;
  if (count === 7) {
    ring = 6;
    index--;
  }
  if (ring >= 3) {
    radius = integer(
      Math.imul(radius, 1000) / scaleSine(integer(180 / ring), 1000),
    );
    if (ring >= 7) radius = integer(Math.imul((index * 3) % 7, radius) / 6);
  }
  const angle = angleShift + integer((index * 360) / ring) + 90;
  let x = scaleSine(angle + 90, radius),
    y = scaleSine(angle, radius);
  if (source.laneSequenceEnabled && count >= 2 && count <= 4 && lane === 1)
    x = -x;
  if (flipY) y = -y;
  return { x: x | 0, y: y | 0 };
}

export const nativeCardFormation = (id: string) =>
  (
    source.cards as Record<
      string,
      { count: number; radius: number; angleShift: number }
    >
  )[id];
