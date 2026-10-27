import type { Battle, Entity, Replay } from "../../src/game/engine";
import type { CardId } from "../../src/game/cards";

export const separationCases = [
  ...[1, 14, 15, 23, 26].flatMap((version) =>
    ["dense", "scattered"].map((layout) => ({
      name: `${layout}-${version}`,
      version,
      layout,
    })),
  ),
  ...["troop", "building"].flatMap((layout) =>
    [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2].flatMap((angle) =>
      [-0.000001, 0, 0.000001].map((offset) => ({
        name: `${layout}-${angle}-${offset}`,
        version: 26,
        layout,
        angle,
        offset,
      })),
    ),
  ),
  ...[0, 0.000999, 0.001, 0.001001].map((distance) => ({
    name: `coincident-${distance}`,
    version: 26,
    layout: "coincident",
    distance,
  })),
];

// Shared inputs only. Expected outputs are captured from the pinned old engine.
export function separationScene(
  Engine: typeof Battle,
  spec: (typeof separationCases)[number],
) {
  const initial = new Engine({ seed: 8921, ai: false });
  const battle = new Engine({
    replay: { ...initial.exportReplay(), version: spec.version } as Replay,
  });
  const spawn = (card: CardId, x: number, y: number) => {
    const start = battle.entities.length;
    (battle as any).spawn(card, start % 2 ? "blue" : "red", x, y);
    const children = battle.entities.slice(start);
    for (const child of children) Object.assign(child, { x, y, deploy: 0 });
    return children[0];
  };
  if (spec.layout === "dense" || spec.layout === "scattered") {
    let state = 91827;
    const random = () =>
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const cards: CardId[] = [
      "knight",
      "giant",
      "minions",
      "hog-rider",
      "battle-ram",
      "bandit",
      "skeleton-army",
    ];
    for (let i = 0; i < 56; i++) {
      const dense = spec.layout === "dense";
      const entity = spawn(
        cards[i % cards.length],
        dense ? 4 + random() * 2 : random() * 18,
        dense ? 15 + random() * 2 : random() * 32,
      );
      if (i % 11 === 0) entity.hp = 0;
      else if (i % 13 === 0) entity.deploy = 0.5;
      else if (entity.card === "bandit")
        entity.dash = { target: 1, elapsed: 0, remaining: 1 };
    }
    spawn("cannon", 4, 16);
    spawn("goblin-hut", 5, 17);
    const hidden = spawn("tesla", 4.5, 15.5);
    if (hidden.burrow) hidden.burrow.phase = "hidden";
    const exposed = spawn("tesla", 13, 16);
    if (exposed.burrow) exposed.burrow.phase = "exposed";
  } else {
    battle.entities = [];
    // Zero origin avoids translation rounding at the exact .001/contact bounds.
    // The mixed scenes separately exercise ordinary arena/bridge positions.
    const a = spawn("knight", 0, 0);
    const b = spawn(spec.layout === "building" ? "cannon" : "giant", 0, 0);
    const boundary =
      spec.layout === "building"
        ? a.radius + b.radius
        : (a.radius + b.radius) * 0.86;
    const distance =
      "distance" in spec
        ? spec.distance!
        : boundary + ("offset" in spec ? spec.offset! : 0);
    const angle = "angle" in spec ? spec.angle! : 0;
    b.x += Math.cos(angle) * distance;
    b.y += Math.sin(angle) * distance;
  }
  return battle;
}

export const separationPositions = (entities: Entity[]) =>
  entities.map(({ id, x, y }) => [id, x, y]);
