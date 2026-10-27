import { describe, expect, it } from "vitest";
import { Battle } from "../src/game/engine";
import { createKingSpellRace } from "../src/game/king-damage";
import { createMatchFinisher } from "../src/game/match-finisher";
import { CARD_MAP } from "../src/game/cards";

function setup(remaining = 8 / 30) {
  const battle = new Battle({ seed: 8, ai: false });
  for (const e of battle.entities) e.active = false;
  const king = battle.entities.find((e) => e.team === "blue" && e.king)!;
  king.hp = 80;
  const spawn = (card = "giant", hp = 100, x = king.x, y = king.y) => {
    (
      battle as unknown as {
        spawn: (card: string, team: string, x: number, y: number) => void;
      }
    ).spawn(card, "blue", x, y);
    const e = battle.entities.at(-1)!;
    Object.assign(e, { hp, deploy: 0, active: false, speed: 0 });
    return e;
  };
  const blocker = spawn();
  battle.areas.push({
    id: 900,
    card: "lightning",
    team: "red",
    x: king.x,
    y: king.y,
    radius: 3.5,
    duration: 1.5,
    remaining,
    hitAt: 1.38,
    struck: [998, 999],
  });
  battle.players.red.hand = ["zap", "pekka", "pekka", "pekka"];
  battle.players.red.elixir = 2;
  return { battle, king, blocker, spawn };
}
const think = (b: Battle) => (b as unknown as { think: () => void }).think();
const step = (b: Battle, n: number) => {
  for (let i = 0; i < n && !b.winner; i++) b.step();
};
const forecast = (b: Battle) =>
  createMatchFinisher(
    "red",
    b.entities,
    b.projectiles,
    b.areas,
    { blue: b.players.blue.crowns, red: b.players.red.crowns },
    b.remaining,
    b.time >= 180,
  );

describe("spells that redirect active Lightning", () => {
  it("forecasts a nonlethal Zap creating a last-pulse King win", () => {
    const { battle, king } = setup();
    const race = createKingSpellRace(
      "zap",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.baseline).toBe(Infinity);
    expect(race.stepAt(king)).toBe(6);
    expect(forecast(battle).outcomeAt("zap", king)).toEqual({
      winner: "red",
      step: 6,
    });
    expect(battle.play("red", 0, king.x, king.y).ok).toBe(true);
    step(battle, 6);
    expect(battle.winner).toBe("red");
  });

  it("chooses the winning combination early in regulation", () => {
    const { battle } = setup();
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 6);
    expect(battle.winner).toBe("red");
  });

  it("does not move a same-step Zap ahead of the final Lightning pulse", () => {
    const { battle, king, blocker } = setup(7 / 30);
    expect(
      createKingSpellRace(
        "zap",
        "red",
        king,
        battle.projectiles,
        battle.areas,
        battle.entities,
      ).stepAt(king),
    ).toBe(Infinity);
    expect(battle.play("red", 0, king.x, king.y).ok).toBe(true);
    step(battle, 8);
    expect(blocker.hp).toBe(0);
    expect(king.hp).toBeCloseTo(3.2);
    expect(battle.winner).toBeNull();
  });

  it("finds a Poison combination that neither spell can finish alone", () => {
    const { battle, king, blocker, spawn } = setup(1.5);
    king.hp = 400;
    blocker.hp = 440;
    spawn("giant", 440);
    spawn("giant", 440);
    Object.assign(battle.areas[0], { hitAt: 0.46, struck: [] });
    battle.players.red.hand[0] = "poison";
    battle.players.red.elixir = 4;
    const race = createKingSpellRace(
      "poison",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.baseline).toBe(Infinity);
    expect(race.stepAt(king)).toBe(43);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    step(battle, 43);
    expect(battle.winner).toBe("red");
  });

  it("uses the ordinary AI timer to combine its newly drawn Zap with Lightning", () => {
    const b = new Battle({ seed: 8, ai: true });
    for (const e of b.entities) e.active = false;
    const king = b.entities.find((e) => e.team === "blue" && e.king)!;
    king.hp = 80;
    for (const card of ["wizard", "witch", "musketeer"]) {
      (
        b as unknown as {
          spawn: (card: string, team: string, x: number, y: number) => void;
        }
      ).spawn(card, "blue", king.x, king.y);
      Object.assign(b.entities.at(-1)!, {
        hp: 100,
        deploy: 0,
        active: false,
        speed: 0,
      });
    }
    b.players.red.hand = ["lightning", "pekka", "pekka", "pekka"];
    b.players.red.queue = ["zap", "pekka", "pekka", "pekka"];
    b.players.red.elixir = 10;
    step(b, 150);
    expect(
      b.actions.filter((a) => a.team === "red").map((a) => a.card),
    ).toEqual(["lightning", "zap"]);
    expect(b.winner).toBe("red");
    expect(b.time).toBe(3.9);
  });

  it("keeps a reserved blocker as an aim point for an indirect King win", () => {
    const { battle, king, blocker } = setup();
    Object.assign(blocker, { x: king.x - 3, y: king.y - 2.5 });
    battle.entities = battle.entities.filter(
      (e) => !(e.team === "blue" && e.kind === "tower" && !e.king),
    );
    battle.players.red.crowns = 2;
    expect(Math.hypot(blocker.x - king.x, blocker.y - king.y)).toBeGreaterThan(
      CARD_MAP.zap.radius! + king.radius,
    );
    expect(
      createKingSpellRace(
        "zap",
        "red",
        king,
        battle.projectiles,
        battle.areas,
        battle.entities,
      ).stepAt(blocker),
    ).toBe(6);
    think(battle);
    const cast = battle.actions.at(-1)!;
    expect(cast.card).toBe("zap");
    expect(Math.hypot(cast.x - blocker.x, cast.y - blocker.y)).toBeLessThan(
      CARD_MAP.zap.radius! + blocker.radius,
    );
    expect(cast.x !== king.x || cast.y !== king.y).toBe(true);
    step(battle, 6);
    expect(battle.winner).toBe("red");
  });

  it("preserves ordinary Princess finishers before the regulation clock matters", () => {
    const { battle } = setup(7 / 30);
    const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
    princess.hp = 50;
    expect(forecast(battle).tracksCrowns).toBe(false);
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 8);
    expect(princess.hp).toBe(0);
    expect(battle.winner).toBeNull();
    expect(battle.players.red.crowns).toBe(1);
  });

  it("preserves an ordinary Poison Princess finisher alongside unrelated Lightning", () => {
    const { battle, king } = setup(7 / 30);
    king.hp = king.maxHp;
    const princess = battle.entities.find((e) => e.team === "blue" && !e.king)!;
    princess.hp = 100;
    battle.players.red.hand = ["poison", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("poison");
    step(battle, 90);
    expect(princess.hp).toBe(0);
    expect(battle.winner).toBeNull();
  });

  it.each(["lightning", "mirror"] as const)(
    "preserves an early Princess finisher with %s alongside unrelated Lightning",
    (card) => {
      const { battle, king } = setup();
      king.hp = king.maxHp;
      Object.assign(battle.areas[0], { x: 4, y: 9 });
      const princess = battle.entities.find(
        (e) => e.team === "blue" && e.kind === "tower" && !e.king,
      )!;
      princess.hp = 100;
      battle.players.red.hand = [card, "pekka", "pekka", "pekka"];
      battle.players.red.lastPlayed = "lightning";
      battle.players.red.elixir = card === "mirror" ? 7 : 6;
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe(card);
      step(battle, 45);
      expect(princess.hp).toBe(0);
      expect(battle.players.red.crowns).toBe(1);
      expect(battle.winner).toBeNull();
    },
  );

  it("does not invent removal value for a reserved Zap target", () => {
    const { battle, king, blocker } = setup();
    king.hp = 900;
    blocker.hp = 1000;
    think(battle);
    expect(battle.actions).toEqual([]);
  });

  it("does not invent removal value for a reserved Poison group", () => {
    const { battle, king, blocker, spawn } = setup(1.5);
    king.hp = 900;
    blocker.hp = 1000;
    Object.assign(battle.areas[0], { x: 4, y: 9, hitAt: 0.46, struck: [] });
    for (const card of ["wizard", "witch", "musketeer"]) spawn(card, 100, 4, 9);
    battle.players.red.hand = ["poison", "pekka", "pekka", "pekka"];
    battle.players.red.elixir = 4;
    think(battle);
    expect(battle.actions).toEqual([]);
  });

  it("uses actual Mirror cost for identical winning combinations", () => {
    const { battle } = setup();
    battle.players.red.hand = ["mirror", "zap", "pekka", "pekka"];
    battle.players.red.lastPlayed = "zap";
    battle.players.red.elixir = 3;
    think(battle);
    expect(battle.actions.at(-1)?.card).toBe("zap");
    step(battle, 6);
    expect(battle.winner).toBe("red");
  });

  it.each([
    { arrival: 7, winner: "red" },
    { arrival: 6, winner: "draw" },
  ] as const)(
    "takes the combination against an incoming King hit on step $arrival",
    ({ arrival, winner }) => {
      const { battle } = setup();
      battle.tick = 6000;
      const own = battle.entities.find((e) => e.team === "red" && e.king)!;
      own.hp = 100;
      battle.projectiles.push({
        id: 901,
        team: "blue",
        source: 800,
        x: own.x,
        y: own.y,
        tx: own.x,
        ty: own.y,
        target: own.id,
        damage: 500,
        remaining: arrival / 30,
        duration: arrival / 30,
        splash: 0,
        air: true,
        style: "musketeer",
        stun: 0,
      });
      think(battle);
      expect(battle.actions.at(-1)?.card).toBe("zap");
      step(battle, 8);
      expect(battle.winner).toBe(winner);
    },
  );

  it("does not add the current Lightning packet again in a proposed follow-up", () => {
    const { battle, king, blocker } = setup();
    king.hp = 1000;
    blocker.hp = 900;
    const race = createKingSpellRace(
      "zap",
      "red",
      king,
      battle.projectiles,
      battle.areas,
      battle.entities,
    );
    expect(race.stepAt(king)).toBe(Infinity);
    expect(forecast(battle).outcomeAt("zap", king)).toBeUndefined();
    expect(battle.play("red", 0, king.x, king.y).ok).toBe(true);
    step(battle, 8);
    expect(king.hp).toBeCloseTo(
      1000 - CARD_MAP.zap.damage * 0.4 - CARD_MAP.lightning.damage * 0.4,
    );
    expect(battle.winner).toBeNull();
  });

  it("separates equally timed aim points by affected bodies without mutating the battle", () => {
    const { battle, king, blocker } = setup();
    const before = JSON.stringify(battle);
    const context = forecast(battle);
    const dx = CARD_MAP.zap.radius! + (king.radius + blocker.radius) / 2;
    expect(context.outcomeAt("zap", king)).toEqual({ winner: "red", step: 6 });
    expect(
      context.outcomeAt("zap", { x: king.x + dx, y: king.y }),
    ).toBeUndefined();
    expect(context.outcomeAt("zap", king)).toEqual({ winner: "red", step: 6 });
    expect(JSON.stringify(battle)).toBe(before);
  });
});
