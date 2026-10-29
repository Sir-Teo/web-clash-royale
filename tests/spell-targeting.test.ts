import { describe, expect, it, vi } from "vitest";
import { Battle, STEP, type Entity, type Projectile } from "../src/game/engine";
import { CARD_MAP, type CardId } from "../src/game/cards";
import { damageSpellTarget } from "../src/game/spell-targeting";
import { perspective, snapshot } from "../src/network/perspective";

function unit(
  id: number,
  card: CardId,
  x: number,
  y: number,
  extra: Partial<Entity> = {},
): Entity {
  const c = CARD_MAP[card];
  return {
    id,
    card,
    kind: c.kind as Entity["kind"],
    team: "blue",
    x,
    y,
    hp: c.hp,
    maxHp: c.hp,
    radius: 0.45,
    air: !!c.air,
    damage: c.damage,
    range: c.range,
    cooldown: 0,
    interval: c.interval,
    speed: c.speed,
    target: null,
    age: 0,
    deploy: 0,
    stun: 0,
    attack: 0,
    move: 0,
    active: true,
    spawnTimer: 0,
    ...extra,
  };
}
function tower(hp: number, king = false): Entity {
  const b = new Battle({ ai: false });
  return {
    ...b.entities.find((e) => e.team === "blue" && !!e.king === king)!,
    hp,
  };
}
function shot(
  x: number,
  y: number,
  damage: number,
  extra: Partial<Projectile> = {},
): Projectile {
  return {
    id: 99,
    team: "red",
    x: 9,
    y: 2,
    tx: x,
    ty: y,
    target: null,
    damage,
    remaining: 1,
    duration: 2,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    source: 0,
    towerDamageFraction: 0.4,
    ...extra,
  };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();

describe("AI damaging spell targets", () => {
  it.each(["fireball", "arrows", "zap", "rocket"] as const)(
    "uses %s's actual Crown Tower damage to identify a lethal target",
    (card) => {
      const damage = Math.ceil(CARD_MAP[card].damage * 40 / 100);
      expect(
        damageSpellTarget(card, "red", [tower(damage)])?.lethalTower,
      ).toBeDefined();
      expect(
        damageSpellTarget(card, "red", [tower(damage + 0.1)]),
      ).toBeUndefined();
    },
  );
  it("prioritizes a lethal King over a Princess and rotates targets for either team", () => {
    const princess = tower(10),
      king = tower(10, true);
    const crowded = Array.from({ length: 100 }, (_, i) =>
      unit(20 + i, "wizard", princess.x, princess.y),
    );
    const plan = damageSpellTarget("rocket", "red", [
      princess,
      king,
      ...crowded,
    ])!;
    expect(plan.lethalTower).toBe(king.id);
    expect(plan).toMatchObject({ x: king.x, y: king.y });
    const b = new Battle({ ai: false });
    b.entities = [princess, king];
    const view = perspective(snapshot(b), "red");
    expect(damageSpellTarget("rocket", "blue", view.entities)).toMatchObject({
      x: 18 - plan.x,
      y: 32 - plan.y,
      lethalTower: king.id,
    });
  });
  it("reserves incoming blasts, including Arrows waves, without counting enemy or expired shots", () => {
    const target = tower(500);
    expect(
      damageSpellTarget(
        "rocket",
        "red",
        [target],
        [shot(target.x, target.y, 1484)],
      ),
    ).toBeUndefined();
    expect(
      damageSpellTarget(
        "rocket",
        "red",
        [target],
        [shot(target.x, target.y, 1484, { team: "blue" })],
      )?.lethalTower,
    ).toBe(target.id);
    expect(
      damageSpellTarget(
        "rocket",
        "red",
        [target],
        [shot(target.x, target.y, 1484, { remaining: 0 })],
      )?.lethalTower,
    ).toBe(target.id);
    const small = tower(100);
    const waves = Array.from({ length: 3 }, (_, i) =>
      shot(small.x, small.y, 130, {
        id: 99 + i,
        towerDamageFraction: undefined,
        style: "arrows",
        delay: i * 0.2,
      }),
    );
    expect(damageSpellTarget("zap", "red", [small], waves)).toBeUndefined();
  });
  it("finds a midpoint covering valuable defenders when neither body's position covers both", () => {
    const a = unit(10, "wizard", 5, 10),
      b = unit(11, "witch", 10, 10);
    const plan = damageSpellTarget("fireball", "red", [a, b])!;
    expect(plan).toMatchObject({ x: 7.5, y: 10 });
    expect(Math.hypot(plan.x - a.x, plan.y - a.y)).toBeLessThan(
      CARD_MAP.fireball.radius! + a.radius,
    );
    expect(Math.hypot(plan.x - b.x, plan.y - b.y)).toBeLessThan(
      CARD_MAP.fireball.radius! + b.radius,
    );
  });
  it("counts swarms per body and avoids expensive damage on a lone skeleton or healthy Giant", () => {
    expect(
      damageSpellTarget("rocket", "red", [unit(10, "skeleton-army", 9, 10)]),
    ).toBeUndefined();
    expect(
      damageSpellTarget("fireball", "red", [unit(10, "giant", 9, 10)]),
    ).toBeUndefined();
    const swarm = Array.from({ length: 15 }, (_, i) =>
      unit(
        10 + i,
        "skeleton-army",
        8 + (i % 5) * 0.25,
        10 + Math.floor(i / 5) * 0.25,
      ),
    );
    expect(damageSpellTarget("arrows", "red", swarm)).toBeDefined();
    expect(damageSpellTarget("zap", "red", swarm)).toBeDefined();
    expect(damageSpellTarget("rocket", "red", swarm)).toBeUndefined();
  });
  it("excludes dead enemies, friends and buried Tesla, while considering exposed buildings", () => {
    const hidden = unit(10, "tesla", 9, 10, {
      burrow: { phase: "hidden", exposure: 0, idle: 0 },
    });
    expect(
      damageSpellTarget("fireball", "red", [
        hidden,
        unit(11, "wizard", 9, 10, { hp: 0 }),
        unit(12, "wizard", 9, 10, { team: "red" }),
      ]),
    ).toBeUndefined();
    const exposed = {
      ...hidden,
      burrow: { phase: "exposed" as const, exposure: 1, idle: 0 },
    };
    expect(
      damageSpellTarget("fireball", "red", [
        exposed,
        unit(11, "wizard", 9, 10),
      ]),
    ).toBeDefined();
  });
  it("does not activate a dormant King for chip damage and does not mutate inputs or consume randomness", () => {
    const king = tower(5000, true),
      wizard = unit(10, "wizard", king.x, king.y);
    const entities = [king, wizard],
      before = structuredClone(entities);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random draw");
    });
    try {
      expect(damageSpellTarget("rocket", "red", entities)).toBeUndefined();
      expect(entities).toEqual(before);
      expect(damageSpellTarget("rage", "red", entities)).toBeUndefined();
    } finally {
      random.mockRestore();
    }
  });
  it("keeps every proposed target legal beside arena boundaries", () => {
    const entities = [
      unit(10, "wizard", 0.4, 0.5),
      unit(11, "witch", 0.6, 0.9),
    ];
    const plan = damageSpellTarget("rocket", "red", entities)!;
    expect(plan.x).toBeGreaterThanOrEqual(0.5);
    expect(plan.y).toBeGreaterThanOrEqual(0.7);
    expect(
      new Battle({ ai: false }).canPlace("red", "rocket", plan.x, plan.y).ok,
    ).toBe(true);
  });
  it("finishes a tower below six elixir and avoids firing again while a lethal spell is in flight", () => {
    const b = new Battle({ seed: 3, ai: false });
    const target = b.entities.find((e) => e.team === "blue" && !e.king)!;
    target.hp = 100;
    b.players.red.hand = ["fireball", "giant", "pekka", "rocket"];
    b.players.red.elixir = 4;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({
      card: "fireball",
      team: "red",
      x: target.x,
      y: target.y,
    });
    b.players.red.hand = ["fireball", "rocket", "pekka", "pekka"];
    b.players.red.elixir = 6;
    const count = b.actions.length;
    think(b);
    expect(b.actions).toHaveLength(count);
    for (let i = 0; i < 200; i++) b.step();
    expect(target.hp).toBeLessThanOrEqual(0);
  });
  it("uses the cheaper lethal spell when several spells can finish the same tower", () => {
    const b = new Battle({ seed: 17, ai: false });
    b.entities.find((e) => e.team === "blue" && !e.king)!.hp = 50;
    b.players.red.hand = ["rocket", "fireball", "arrows", "zap"];
    b.players.red.elixir = 10;
    think(b);
    expect(b.actions.at(-1)?.card).toBe("zap");
    expect(b.players.red.elixir).toBe(8);
  });
  it("holds a marginal mirrored Fireball, then spends its real cost on a useful target", () => {
    const b = new Battle({ ai: false });
    const target = unit(50, "musketeer", 4, 18);
    b.entities.push(target);
    b.players.red.hand = ["mirror", "pekka", "pekka", "pekka"];
    b.players.red.lastPlayed = "fireball";
    b.players.red.elixir = 5;
    expect(damageSpellTarget("fireball", "red", b.entities)).toBeDefined();
    think(b);
    expect(b.actions).toHaveLength(0);
    expect(b.players.red.elixir).toBe(5);
    target.hp = CARD_MAP.fireball.damage;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({
      card: "mirror",
      team: "red",
      x: target.x,
      y: target.y,
    });
    expect(b.players.red.elixir).toBe(0);
    expect(b.projectiles.at(-1)?.style).toBe("fireball");
    for (let i = 0; i < 150; i++) b.step();
    expect(target.hp).toBeLessThanOrEqual(0);
  });
  it("always prefers the ordinary finisher over a more expensive Mirror of the same spell", () => {
    for (const card of ["fireball", "arrows", "zap", "rocket"] as const)
      for (let seed = 1; seed <= 16; seed++) {
        const b = new Battle({ seed, ai: false });
        b.entities.find((e) => e.team === "blue" && !e.king)!.hp = 1;
        b.players.red.hand = ["mirror", card, "pekka", "pekka"];
        b.players.red.lastPlayed = card;
        b.players.red.elixir = CARD_MAP[card].cost + 1;
        think(b);
        expect(b.actions.at(-1)?.card, `${card}, seed ${seed}`).toBe(card);
        expect(b.players.red.elixir).toBe(1);
      }
  });
  it("keeps a mirrored King finisher ahead of a cheaper Princess finisher and wins the battle", () => {
    const b = new Battle({ seed: 17, ai: false });
    const king = b.entities.find((e) => e.team === "blue" && e.king)!;
    const princess = b.entities.find((e) => e.team === "blue" && !e.king)!;
    king.hp = 300;
    princess.hp = 10;
    b.players.red.hand = ["mirror", "zap", "pekka", "pekka"];
    b.players.red.lastPlayed = "rocket";
    b.players.red.elixir = 7;
    think(b);
    expect(b.actions.at(-1)).toMatchObject({
      card: "mirror",
      x: king.x,
      y: king.y,
    });
    expect(b.players.red.elixir).toBe(0);
    for (let i = 0; i < 200 && !b.winner; i++) b.step();
    expect(b.winner).toBe("red");
    expect(king.hp).toBeLessThanOrEqual(0);
    expect(b.players.red.crowns).toBe(3);
    expect(b.actions).toHaveLength(1);
  });
  it("selects a useful far-side cluster rather than holding all damage spells for river crossings", () => {
    const b = new Battle({ seed: 3, ai: false });
    b.entities.push(unit(10, "wizard", 4, 23), unit(11, "witch", 4.5, 23));
    b.players.red.hand = ["fireball", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 4;
    think(b);
    expect(b.actions.at(-1)?.card).toBe("fireball");
    expect(b.players.red.elixir).toBe(0);
    b.step();
    expect(b.time).toBe(STEP);
  });
});
