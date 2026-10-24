import { describe, it, expect } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import { CARD_MAP, STARTER_DECK } from "../src/game/cards";
const advance = (b: Battle, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) b.step();
};
describe("battle rules", () => {
  it("deploys the archived three Goblins and four Skeletons for their card costs", () => {
    const battle = new Battle({ seed: 11, ai: false });
    battle.players.blue.hand[0] = "goblins";
    battle.players.red.hand[0] = "skeletons";
    expect(battle.play("blue", 0, 4, 22).ok).toBe(true);
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    expect(battle.entities.filter((e) => e.team === "blue" && e.card === "goblins")).toHaveLength(3);
    expect(battle.entities.filter((e) => e.team === "red" && e.card === "skeletons")).toHaveLength(4);
    expect(battle.players.blue.elixir).toBe(3);
    expect(battle.players.red.elixir).toBe(4);
  });
  it("can route a returning defender back across a bridge", () => {
    const b = new Battle({ ai: false, seed: 2 });
    b.players.blue.elixir = 10;
    b.players.red.elixir = 10;
    b.players.blue.hand[0] = "knight";
    b.players.red.hand[0] = "cannon";
    b.play("blue", 0, 4, 20);
    b.play("red", 0, 9, 10);
    const knight = b.entities.find((e) => e.card === "knight")!,
      cannon = b.entities.find((e) => e.card === "cannon")!;
    knight.y = 15;
    cannon.x = 4;
    cannon.y = 20;
    cannon.damage = 0;
    cannon.range = 0;
    for (const t of b.entities.filter((e) => e.kind === "tower"))
      t.active = false;
    advance(b, 6);
    expect(knight.y).toBeGreaterThan(17);
  });
  it("spends elixir and cycles exactly through the next four cards", () => {
    const b = new Battle({ seed: 42, ai: false });
    b.players.blue.elixir = 10;
    const first = b.players.blue.hand[0],
      next = b.players.blue.queue[0];
    const r = b.play("blue", 0, 4, 22);
    expect(r.ok).toBe(true);
    expect(b.players.blue.elixir).toBe(10 - CARD_MAP[first].cost);
    expect(b.players.blue.hand[0]).toBe(next);
    expect(b.players.blue.queue.at(-1)).toBe(first);
  });
  it("rejects enemy territory, invalid coordinates, tower overlaps and insufficient elixir without mutations", () => {
    const b = new Battle({ seed: 42, ai: false });
    b.players.blue.hand = [...STARTER_DECK.slice(0, 4)];
    for (const [x, y] of [
      [4, 6],
      [9, 16],
      [9, 29.5],
      [NaN, 20],
    ])
      expect(b.play("blue", 0, x, y).ok).toBe(false);
    b.players.blue.elixir = 0;
    expect(b.play("blue", 0, 4, 20).ok).toBe(false);
    expect(b.actions).toHaveLength(0);
  });
  it("lets spells target either half and applies reduced crown tower damage", () => {
    const b = new Battle({ seed: 1, ai: false });
    b.players.blue.hand[0] = "fireball";
    b.players.blue.elixir = 10;
    const t = b.entities.find((e) => e.team === "red" && !e.king)!;
    const hp = t.hp;
    expect(b.play("blue", 0, t.x, t.y).ok).toBe(true);
    advance(b, 3);
    expect(t.hp).toBeCloseTo(hp - CARD_MAP.fireball.damage * 0.4);
  });
  it("requires ground troops to cross the bridges", () => {
    const b = new Battle({ seed: 1, ai: false });
    b.players.blue.hand[0] = "knight";
    b.players.blue.elixir = 10;
    b.play("blue", 0, 8, 18);
    let crosses = false;
    for (let i = 0; i < 1800; i++) {
      b.step();
      const e = b.entities.find((e) => e.card === "knight");
      if (e && e.y > 14.8 && e.y < 17.2) {
        crosses = true;
        expect(Math.min(Math.abs(e.x - 4), Math.abs(e.x - 14))).toBeLessThan(
          0.7,
        );
      }
    }
    expect(crosses).toBe(true);
  });
  it("regenerates capped elixir and increases the rate at the correct phases", () => {
    const b = new Battle({ seed: 1, ai: false });
    advance(b, 2.8);
    expect(b.players.blue.elixir).toBeCloseTo(6);
    advance(b, 20);
    expect(b.players.blue.elixir).toBe(10);
    b.tick = 120 / STEP;
    expect(b.multiplier).toBe(2);
    b.tick = 240 / STEP;
    expect(b.multiplier).toBe(3);
  });
  it("produces identical complete state when replaying recorded commands", () => {
    const b = new Battle({ seed: 77 });
    for (let i = 0; i < 3600; i++) {
      if (i % 130 === 0) {
        const slot = b.players.blue.hand.findIndex(
          (id) => CARD_MAP[id].cost <= b.players.blue.elixir,
        );
        if (slot >= 0) b.play("blue", slot, 4, 20);
      }
      b.step();
    }
    const replay = new Battle({ replay: b.exportReplay() });
    for (let i = 0; i < b.tick; i++) replay.step();
    expect(replay.entities).toEqual(b.entities);
    expect(replay.players).toEqual(b.players);
    expect(replay.projectiles).toEqual(b.projectiles);
  });
  it("finishes a tie at five minutes and prevents actions after the match", () => {
    const b = new Battle({ seed: 1, ai: false });
    advance(b, 301);
    expect(b.winner).toBe("draw");
    expect(b.time).toBe(300);
    expect(b.play("blue", 0, 4, 20).ok).toBe(false);
  });
  it("keeps AI within its elixir budget and allows a full match to resolve", () => {
    const b = new Battle({ seed: 87 });
    advance(b, 301);
    expect(b.winner).toBe("red");
    expect(b.players.red.elixir).toBeGreaterThanOrEqual(0);
    expect(b.actions.length).toBeGreaterThan(0);
  });
  it("activates the King Tower when a Princess Tower falls and opens that lane for deployments", () => {
    const b = new Battle({ seed: 1, ai: false });
    const tower = b.entities.find(
      (e) => e.team === "red" && e.lane === "left",
    )!;
    tower.hp = 1;
    expect(b.canPlace("blue", "knight", 4, 12).ok).toBe(false);
    b.players.blue.elixir = 10;
    b.players.blue.hand[0] = "zap";
    b.play("blue", 0, 4, 6);
    advance(b, 0.3);
    expect(b.players.blue.crowns).toBe(1);
    expect(b.entities.find((e) => e.team === "red" && e.king)?.active).toBe(
      true,
    );
    expect(b.canPlace("blue", "knight", 4, 12).ok).toBe(true);
    expect(b.canPlace("blue", "knight", 14, 12).ok).toBe(false);
  });
  it("wins immediately when the opposing King Tower is destroyed", () => {
    const b = new Battle({ seed: 1, ai: false });
    b.entities.find((e) => e.team === "red" && e.king)!.hp = 1;
    b.players.blue.elixir = 10;
    b.players.blue.hand[0] = "fireball";
    b.play("blue", 0, 9, 2.5);
    advance(b, 3);
    expect(b.winner).toBe("blue");
    expect(b.players.blue.crowns).toBe(3);
  });
  it("building-targeting troops ignore nearby defenders", () => {
    const b = new Battle({ seed: 1, ai: false });
    b.players.blue.elixir = 10;
    b.players.red.elixir = 10;
    b.players.blue.hand[0] = "giant";
    b.players.red.hand[0] = "knight";
    b.play("blue", 0, 4, 20);
    b.play("red", 0, 4, 12);
    const knight = b.entities.find((e) => e.card === "knight")!;
    knight.y = 19;
    advance(b, 1.2);
    const giant = b.entities.find((e) => e.card === "giant")!;
    expect(giant.target).not.toBe(knight.id);
    expect(b.entities.find((e) => e.id === giant.target)?.kind).toBe("tower");
  });
  it("expires defensive buildings and periodically spawns Witch skeletons", () => {
    const b = new Battle({ seed: 1, ai: false });
    b.players.blue.elixir = 10;
    b.players.blue.hand[0] = "cannon";
    b.play("blue", 0, 9, 22);
    b.players.blue.hand[0] = "witch";
    b.play("blue", 0, 14, 21);
    advance(b, 5.2);
    expect(b.entities.filter((e) => e.card === "skeletons")).toHaveLength(3);
    advance(b, 27);
    expect(b.entities.some((e) => e.card === "cannon")).toBe(false);
  });
  it("begins overtime only for tied crown counts", () => {
    const tied = new Battle({ seed: 1, ai: false });
    advance(tied, 180);
    expect(tied.winner).toBeNull();
    expect(tied.phase).toBe("overtime");
    expect(tied.remaining).toBe(120);
    const ahead = new Battle({ seed: 1, ai: false });
    ahead.players.blue.crowns = 1;
    advance(ahead, 180);
    expect(ahead.winner).toBe("blue");
  });
});
