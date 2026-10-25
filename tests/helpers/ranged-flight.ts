import { CARD_MAP, type CardId } from "../../src/game/cards";
import { combatTraits } from "../../src/game/combat";
import {
  Battle,
  type Entity,
  type Projectile,
  type Team,
} from "../../src/game/engine";

type Source = CardId | "tower:king" | "tower:princess";
export interface FlightCase {
  source: Source;
  team: Team;
  angle: number;
}
const sources: Source[] = [
  ...Object.values(CARD_MAP)
    .filter(
      (c) =>
        c.kind !== "spell" &&
        (combatTraits({ card: c.id }).projectile ||
          c.id === "balloon" ||
          c.id === "tesla"),
    )
    .map((c) => c.id),
  "tower:king",
  "tower:princess",
];
export const flightCases: FlightCase[] = sources.flatMap((source) =>
  (["blue", "red"] as const).flatMap((team) =>
    [0, 0.65].map((angle) => ({ source, team, angle })),
  ),
);
export const flightKey = (c: FlightCase) => `${c.source}/${c.team}/${c.angle}`;

export function flightBattle(c: FlightCase) {
  const initial = new Battle({ seed: 12, ai: false }).exportReplay();
  const battle = new Battle({
    replay: { ...initial, rulesFamily: "origin", version: 16, duration: 180 },
  });
  const target = battle.entities.find((e) => e.king && e.team !== c.team)!;
  const ownKing = battle.entities.find((e) => e.king && e.team === c.team)!;
  target.active = ownKing.active = false;
  target.hp = 1;
  let attacker: Entity;
  if (c.source.startsWith("tower:")) {
    attacker = battle.entities.find(
      (e) => e.team === c.team && !!e.king === (c.source === "tower:king"),
    )!;
    // Keep a separate inactive own King when the attacker itself is the King.
    if (attacker === ownKing) battle.entities = [target, ownKing];
    else battle.entities = [target, ownKing, attacker];
  } else {
    (
      battle as unknown as {
        spawn: (id: CardId, team: Team, x: number, y: number) => void;
      }
    ).spawn(c.source as CardId, c.team, 9, 16);
    attacker = battle.entities.at(-1)!;
    battle.entities = [target, ownKing, attacker];
  }
  const distance = attacker.air
    ? attacker.range + target.radius * 0.5
    : Math.max(
        attacker.range + target.radius * 0.5,
        attacker.radius + target.radius + 0.1,
      );
  Object.assign(attacker, {
    x: target.x + Math.sin(c.angle) * distance,
    y: target.y + (c.team === "blue" ? 1 : -1) * Math.cos(c.angle) * distance,
    active: true,
    activation: 0,
    deploy: 0,
    cooldown: 100,
    target: target.id,
    pendingAttack: {
      target: target.id,
      remaining: 0.2,
      damage: attacker.damage,
    },
  });
  if (attacker.burrow)
    attacker.burrow = { phase: "exposed", exposure: 1, idle: 0 };
  return { battle, attacker, target };
}

/** Observe combat's launch packets and actual first target damage. */
export function observeFlight(c: FlightCase) {
  const { battle, attacker, target } = flightBattle(c);
  const actor = battle as unknown as {
    releaseAttack: (e: Entity, target: Entity, damage: number) => void;
  };
  const release = actor.releaseAttack.bind(battle);
  const launches: Projectile[] = [];
  let releaseTick = -1;
  actor.releaseAttack = (e, victim, damage) => {
    const ids = new Set(battle.projectiles.map((p) => p.id));
    release(e, victim, damage);
    if (e.id === attacker.id) {
      releaseTick = battle.tick;
      launches.push(
        ...structuredClone(battle.projectiles.filter((p) => !ids.has(p.id))),
      );
    }
  };
  for (let step = 0; step < 180 && target.hp > 0; step++) battle.step();
  if (target.hp > 0 || releaseTick < 0)
    throw new Error(`No target impact: ${flightKey(c)}`);
  return { key: flightKey(c), releaseTick, hitTick: battle.tick, launches };
}
