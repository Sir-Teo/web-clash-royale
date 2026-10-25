import { describe, expect, it } from "vitest";
import { Battle, type Projectile } from "../src/game/engine";
import { directSpellFlight } from "../src/game/combat";
import { damageSpellTarget } from "../src/game/spell-targeting";

function setup() {
  const battle = new Battle({ seed: 12, ai: false });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.king && e.team === "red")!;
  const enemyKing = battle.entities.find((e) => e.king && e.team === "blue")!;
  king.hp = 100;
  enemyKing.hp = 50;
  battle.players.red.hand = ["arrows", "fireball", "pekka", "pekka"];
  battle.players.red.elixir = 4;
  const incoming = (remaining: number, damage = 500): Projectile => ({
    id: 900,
    team: "blue",
    source: 0,
    x: 9,
    y: 30,
    tx: king.x,
    ty: king.y,
    target: null,
    damage,
    remaining,
    duration: remaining,
    splash: 2,
    air: true,
    style: "rocket",
    stun: 0,
    towerDamageFraction: 0.4,
  });
  return { battle, king, enemyKing, incoming };
}
const think = (battle: Battle) =>
  (battle as unknown as { think: () => void }).think();
const finish = (battle: Battle) => {
  for (let step = 0; step < 300 && !battle.winner; step++) battle.step();
};

describe("AI finishers against launched King damage", () => {
  it("keeps waiting when an already launched shot wins before the incoming damage", () => {
    const { battle, king, enemyKing, incoming } = setup();
    battle.projectiles.push(incoming(0.2), {
      ...incoming(0.1),
      id: 901,
      team: "red",
      tx: enemyKing.x,
      ty: enemyKing.y,
    });
    battle.players.red.hand = ["zap", "arrows", "pekka", "pekka"];
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions).toEqual([]);
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("uses a mirrored Zap to accelerate the reserved King kill at its actual cost", () => {
    const { battle, king, enemyKing, incoming } = setup();
    battle.projectiles.push(incoming(0.2), {
      ...incoming(3),
      id: 901,
      team: "red",
      tx: enemyKing.x,
      ty: enemyKing.y,
    });
    battle.players.red.hand = ["mirror", "arrows", "pekka", "pekka"];
    battle.players.red.lastPlayed = "zap";
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("mirror");
    expect(battle.players.red.elixir).toBe(0);
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("chooses a faster center for the same Fireball instead of adding a distant troop to a losing blast", () => {
    const { battle, king, enemyKing, incoming } = setup();
    enemyKing.hp = 200;
    (
      battle as unknown as {
        spawn: (id: string, team: string, x: number, y: number) => void;
      }
    ).spawn("pekka", "blue", 14, 31);
    Object.assign(battle.entities.at(-1)!, { deploy: 0, active: false });
    const crowded = damageSpellTarget("fireball", "red", battle.entities)!;
    expect(
      directSpellFlight("fireball", "red", crowded).duration,
    ).toBeGreaterThan(2.8);
    battle.projectiles.push(incoming(2.8));
    battle.players.red.hand = ["fireball", "pekka", "pekka", "pekka"];
    think(battle);
    const action = battle.actions.at(-1)!;
    expect(action.card).toBe("fireball");
    expect(directSpellFlight("fireball", "red", action).duration).toBeLessThan(
      2.8,
    );
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("takes an earlier Poison tick instead of cheaper Arrows that lose to an incoming Rocket", () => {
    const control = setup();
    control.enemyKing.hp = 40;
    control.battle.projectiles.push(control.incoming(1.5));
    expect(
      control.battle.play("red", 0, control.enemyKing.x, control.enemyKing.y)
        .ok,
    ).toBe(true);
    finish(control.battle);
    expect(control.battle.winner).toBe("blue");
    const { battle, king, incoming } = setup();
    battle.entities.find((e) => e.king && e.team === "blue")!.hp = 40;
    battle.players.red.hand = ["arrows", "poison", "pekka", "pekka"];
    battle.projectiles.push(incoming(1.5));
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("accelerates a fully reserved slow King kill when an earlier Zap is needed to win", () => {
    const { battle, king, enemyKing, incoming } = setup();
    battle.projectiles.push(incoming(0.2), {
      ...incoming(3),
      id: 901,
      team: "red",
      tx: enemyKing.x,
      ty: enemyKing.y,
    });
    battle.players.red.hand = ["zap", "arrows", "pekka", "pekka"];
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("combines a queued troop shot with a new Zap before the fatal incoming shot", () => {
    const { battle, king, enemyKing, incoming } = setup();
    enemyKing.hp = 280;
    battle.projectiles.push(incoming(0.2), {
      ...incoming(0.1),
      id: 901,
      team: "red",
      source: 123,
      target: enemyKing.id,
      tx: enemyKing.x,
      ty: enemyKing.y,
      damage: 218,
      splash: 0,
      style: "musketeer",
    });
    battle.players.red.hand = ["zap", "fireball", "pekka", "pekka"];
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(100);
  });

  it("sums incoming packets that are harmless individually", () => {
    const { battle, king, incoming } = setup();
    king.hp = 150;
    battle.entities.find((e) => e.king && e.team === "blue")!.hp = 40;
    battle.players.red.hand = ["arrows", "poison", "pekka", "pekka"];
    battle.projectiles.push(incoming(1.3, 200), {
      ...incoming(1.5, 200),
      id: 901,
    });
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(150);
  });

  it("prefers a same-step draw to a cheaper spell that arrives after defeat", () => {
    const { battle, incoming } = setup();
    battle.entities.find((e) => e.king && e.team === "blue")!.hp = 40;
    battle.players.red.hand = ["arrows", "poison", "pekka", "pekka"];
    battle.projectiles.push(incoming(1));
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    finish(battle);
    expect(battle.winner).toBe("draw");
  });

  it("lets a shield absorb a full packet before evaluating body damage", () => {
    const { battle, king, incoming } = setup();
    king.shield = king.maxShield = 10;
    battle.projectiles.push(incoming(0.1), { ...incoming(0.2, 200), id: 901 });
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("arrows");
    finish(battle);
    expect(battle.winner).toBe("red");
    expect(king.hp).toBe(20);
  });
});
