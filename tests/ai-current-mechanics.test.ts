import { describe, expect, it } from "vitest";
import { Battle, type Entity, type Projectile } from "../src/game/engine";
import { type CardId } from "../src/game/cards";
import { aiBodyValue } from "../src/game/ai-body-value";
import { areaSpellTarget } from "../src/game/area-spell-targeting";
import { damageSpellTarget, pendingSpellDamage } from "../src/game/spell-targeting";

function troop(b: Battle, card: CardId, team: Entity["team"], x: number, y: number) {
  (b as unknown as { spawn: (card: CardId, team: Entity["team"], x: number, y: number) => void })
    .spawn(card, team, x, y);
  const entity = b.entities.at(-1)!;
  entity.deploy = 0;
  return entity;
}
function shot(entity: Entity, damage: number, id = 100): Projectile {
  return {
    id, team: "red", x: entity.x, y: entity.y, tx: entity.x, ty: entity.y,
    target: null, damage, remaining: id / 100, duration: 2, splash: 2,
    air: true, style: "fireball", stun: 0, source: 0,
  };
}

describe("AI follows current card mechanics", () => {
  it("does not buy Rage for defending buildings and Crown Towers alone", () => {
    const b = new Battle({ ai: false });
    troop(b, "cannon", "red", 14, 6);
    troop(b, "giant", "blue", 14, 8);
    b.players.red.hand = ["rage", "pekka", "giant", "musketeer"];
    b.players.red.elixir = 2;
    (b as unknown as { think: () => void }).think();
    expect(b.actions).toHaveLength(0);
    expect(areaSpellTarget("rage", "red", b.entities)).toBeUndefined();
  });

  it("does not Freeze a building-seeker to protect troops it cannot attack", () => {
    const b = new Battle({ ai: false });
    const giant = troop(b, "giant", "blue", 4, 20);
    const defender = troop(b, "pekka", "red", 4, 21);
    expect(areaSpellTarget("freeze", "red", [giant, defender])).toBeUndefined();
    const enemy = troop(b, "pekka", "blue", 4, 20);
    expect(areaSpellTarget("freeze", "red", [enemy, defender])).toBeDefined();
  });

  it("excludes invulnerable dashing Bandits from direct damage and Freeze value", () => {
    const b = new Battle({ ai: false });
    const bandits = [4, 4.3].map((x) => troop(b, "bandit", "blue", x, 10));
    for (const bandit of bandits) {
      bandit.dash = { target: 1, elapsed: 0, remaining: 0.3 };
    }
    const defender = troop(b, "pekka", "red", 4, 11);
    expect(damageSpellTarget("fireball", "red", bandits)).toBeUndefined();
    expect(areaSpellTarget("freeze", "red", [...bandits, defender])).toBeUndefined();
    expect(pendingSpellDamage(bandits[0], "red", [shot(bandits[0], 1000)])).toBe(0);
    for (const bandit of bandits) bandit.dash = undefined;
    expect(damageSpellTarget("fireball", "red", bandits)).toBeDefined();
    expect(areaSpellTarget("freeze", "red", [...bandits, defender])).toBeDefined();
  });

  it("still removes a dangerous cloned army despite its one-hit bodies", () => {
    const b = new Battle({ ai: false });
    const clones = [4, 4.2, 4.4].map((x) => troop(b, "wizard", "blue", x, 10));
    for (const clone of clones) Object.assign(clone, { hp: 1, maxHp: 1, clone: true });
    expect(damageSpellTarget("arrows", "red", clones)).toBeDefined();
  });

  it("values actual Lava Pup swarms as damage targets and Rage support", () => {
    const b = new Battle({ ai: false });
    const pups = Array.from({ length: 6 }, (_, i) =>
      troop(b, "lava-pup", "blue", 4 + i * 0.1, 10));
    expect(aiBodyValue(pups[0])).toBe(1);
    expect(damageSpellTarget("arrows", "red", pups)).toBeDefined();
    for (const pup of pups) Object.assign(pup, { team: "red", y: 20 });
    expect(areaSpellTarget("rage", "red", pups)).toBeDefined();
  });

  it("includes actual Golemites in damage and support value", () => {
    const b = new Battle({ ai: false });
    const fragments = [4, 4.2].map((x) => troop(b, "golemite", "blue", x, 10));
    expect(aiBodyValue(fragments[0])).toBe(2);
    for (const fragment of fragments) fragment.hp = fragment.maxHp / 2;
    expect(damageSpellTarget("fireball", "red", fragments)).toBeDefined();
    for (const fragment of fragments) Object.assign(fragment, { team: "red", y: 20 });
    const knight = troop(b, "knight", "red", 4, 20);
    expect(areaSpellTarget("rage", "red", [...fragments, knight])).toBeDefined();
    const enemy = troop(b, "pekka", "blue", 4, 21);
    expect(areaSpellTarget("freeze", "red", [...fragments, enemy])).toBeDefined();
  });

  it("reserves shield packets without carrying their excess damage into body HP", () => {
    const b = new Battle({ ai: false });
    const guard = troop(b, "dark-prince", "blue", 4, 10);
    guard.shield = 50;
    guard.hp = 500;
    expect(pendingSpellDamage(guard, "red", [shot(guard, 1000)])).toBe(50);
    expect(pendingSpellDamage(guard, "red", [shot(guard, 1000), shot(guard, 100, 101)]))
      .toBe(150);
    // One oversized hit cannot remove even a one-HP body behind a shield.
    guard.hp = 1;
    guard.shield = 1;
    expect(damageSpellTarget("fireball", "red", [guard])).toBeUndefined();
    // Once an existing packet breaks the shield, the later finishing spell is useful.
    const army = [guard, { ...guard, id: guard.id + 1, x: 4.2 }];
    expect(damageSpellTarget("arrows", "red", army, [shot(guard, 1000)])).toBeDefined();
  });
});
