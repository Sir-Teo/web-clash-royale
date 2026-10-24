import { describe, expect, it } from "vitest";
import { Battle, STEP } from "../src/game/engine";
import type { Entity, Replay, Team } from "../src/game/engine";
import { CARDS, CARD_MAP, STARTER_DECK } from "../src/game/cards";
import type { CardId } from "../src/game/cards";
import { combatTraits, KING_ACTIVATION_TIME } from "../src/game/combat";
import legacy from "./fixtures/legacy-replay.json";
import combatV2 from "./fixtures/combat-v2-replay.json";
import combatV3 from "./fixtures/combat-v3-replay.json";
import combatV4 from "./fixtures/combat-v4-replay.json";

const advance = (b: Battle, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) b.step();
};
function sandbox() {
  const b = new Battle({ seed: 8, ai: false });
  for (const t of b.entities) t.active = false;
  return b;
}
function cast(b: Battle, id: CardId, team: Team, x: number, y: number) {
  b.players[team].hand[0] = id;
  b.players[team].elixir = 10;
  expect(b.play(team, 0, x, y).ok).toBe(true);
}
function unit(b: Battle, id: CardId, team: Team, x: number, y: number) {
  const ids = new Set(b.entities.map((e) => e.id));
  cast(b, id, team, 4, team === "blue" ? 22 : 10);
  const e = b.entities.find((e) => !ids.has(e.id))!;
  b.entities = b.entities.filter((v) => ids.has(v.id) || v.id === e.id);
  Object.assign(e, { x, y, deploy: 0, cooldown: 0 });
  return e;
}
function dummy(b: Battle, id: CardId, team: Team, x: number, y: number) {
  const e = unit(b, id, team, x, y);
  Object.assign(e, { active: false, hp: 10000, maxHp: 10000 });
  return e;
}
function awaitShot(b: Battle, source: Entity) {
  for (let i = 0; i < 100; i++) {
    b.step();
    const shot = b.projectiles.find((p) => p.source === source.id);
    if (shot) {
      source.active = false;
      return shot;
    }
  }
  throw new Error("Attacker failed to launch a projectile");
}

describe("combat timing and targeting", () => {
  it("has archival combat traits for every troop, building and tower", () => {
    for (const card of CARDS.filter((c) => c.kind !== "spell")) {
      const traits = combatTraits({ card: card.id });
      expect(traits.windup).toBeGreaterThanOrEqual(0);
      if (card.id === "inferno-dragon") expect(traits.windup).toBe(0);
      if (["elixir-collector", "goblin-hut", "tombstone", "furnace", "barbarian-hut"].includes(card.id)) {
        expect(traits.sight).toBe(0);
        expect(traits.projectile).toBeNull();
      } else expect(traits.sight).toBeGreaterThan(0);
      if (traits.projectile) expect(traits.projectile.speed).toBeGreaterThan(0);
    }
    expect(combatTraits({ card: "tower", king: true }).projectile?.homing).toBe(
      true,
    );
    expect(combatTraits({ card: "bomber" }).projectile?.homing).toBe(false);
  });
  it("reacquires a nearby defender instead of remaining locked on a distant tower", () => {
    const b = sandbox(),
      knight = unit(b, "knight", "blue", 9, 21);
    b.step();
    expect(b.entities.find((e) => e.id === knight.target)?.kind).toBe("tower");
    const defender = dummy(b, "knight", "red", 9, 18);
    b.step();
    expect(knight.target).toBe(defender.id);
  });
  it("pulls a building-targeting Giant toward a newly placed Cannon and ignores troops", () => {
    const b = sandbox(),
      giant = unit(b, "giant", "blue", 9, 21);
    dummy(b, "knight", "red", 9, 19);
    b.step();
    expect(b.entities.find((e) => e.id === giant.target)?.kind).toBe("tower");
    const cannon = dummy(b, "cannon", "red", 9, 18.5);
    b.step();
    expect(giant.target).toBe(cannon.id);
  });
  it("lands melee damage after the swing windup and respects the hit interval", () => {
    const b = sandbox(),
      knight = unit(b, "knight", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 19.9);
    b.step();
    expect(knight.pendingAttack?.remaining).toBeCloseTo(0.4);
    advance(b, 0.3);
    expect(target.hp).toBe(10000);
    advance(b, 0.1);
    expect(target.hp).toBe(10000 - knight.damage);
    advance(b, knight.interval - STEP);
    expect(target.hp).toBe(10000 - knight.damage);
    b.step();
    expect(target.hp).toBe(10000 - knight.damage * 2);
  });
  it.each(["move", "target dies", "attacker dies"])(
    "cancels a pending melee hit when %s",
    (reason) => {
      const b = sandbox(),
        knight = unit(b, "knight", "blue", 9, 21);
      const target = dummy(b, "knight", "red", 9, 19.9);
      b.step();
      advance(b, 0.2);
      if (reason === "move") target.x = 13;
      if (reason === "target dies") target.hp = 0;
      if (reason === "attacker dies") knight.hp = 0;
      advance(b, 0.3);
      expect(
        b.events.filter((e) => e.type === "hit" && e.card === "knight"),
      ).toHaveLength(0);
      if (reason !== "target dies") expect(target.hp).toBe(10000);
    },
  );
  it("Zap cancels an unfinished charged hit and Prince restarts with normal damage", () => {
    const b = sandbox(),
      prince = unit(b, "prince", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 19.9);
    prince.move = 3;
    b.step();
    expect(prince.pendingAttack?.damage).toBe(prince.damage * 2);
    cast(b, "zap", "red", 9, 21);
    advance(b, 0.2);
    expect(prince.pendingAttack).toBeUndefined();
    expect(prince.stun).toBeGreaterThan(0);
    expect(prince.move).toBe(0);
    expect(target.hp).toBe(10000);
    advance(b, 0.4);
    expect(target.hp).toBe(10000);
    advance(b, 0.7);
    expect(target.hp).toBe(10000 - prince.damage);
  });
});

describe("projectile impacts", () => {
  it("retains all delayed Arrow waves even when cast at the launch point", () => {
    const b = sandbox(),
      target = dummy(b, "knight", "red", 9, 31.1);
    cast(b, "arrows", "blue", 9, 30);
    advance(b, 0.5);
    expect(target.hp).toBe(10000 - CARD_MAP.arrows.damage);
    expect(
      b.events.filter((e) => e.type === "hit" && e.card === "arrows"),
    ).toHaveLength(3);
  });
  it("a Bomber throw lands at its original aim and can miss a moving target", () => {
    const b = sandbox(),
      bomber = unit(b, "bomber", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 24);
    const shot = awaitShot(b, bomber);
    expect(shot.homing).toBe(false);
    target.x = 13;
    advance(b, 2);
    expect(target.hp).toBe(10000);
    const impact = b.events.find(
      (e) => e.type === "hit" && e.card === "bomber",
    )!;
    expect([impact.x, impact.y]).toEqual([9, 24]);
  });
  it("a homing shot follows a moving target after its attacker is defeated", () => {
    const b = sandbox(),
      musketeer = unit(b, "musketeer", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 24);
    const shot = awaitShot(b, musketeer);
    expect(shot.homing).toBe(true);
    target.x = 12;
    musketeer.hp = 0;
    advance(b, 1);
    expect(target.hp).toBe(10000 - musketeer.damage);
    const impact = b.events.find(
      (e) => e.type === "hit" && e.card === "musketeer",
    )!;
    expect([impact.x, impact.y]).toEqual([12, 24]);
  });
  it("a dead target does not redirect a shot into another troop", () => {
    const b = sandbox(),
      archer = unit(b, "archers", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 24);
    awaitShot(b, archer);
    target.hp = 0;
    const replacement = dummy(b, "knight", "red", 9, 24);
    advance(b, 2);
    expect(replacement.hp).toBe(10000);
  });
  it("Fireball takes longer to reach the far side and knocks back only movable enemies", () => {
    const b = sandbox();
    const knight = dummy(b, "knight", "red", 9, 21);
    const giant = dummy(b, "giant", "red", 10.5, 20);
    const friend = dummy(b, "knight", "blue", 7.5, 20);
    cast(b, "fireball", "blue", 9, 20);
    const nearDuration = b.projectiles[0].duration;
    cast(b, "fireball", "blue", 9, 3);
    expect(b.projectiles[1].duration).toBeGreaterThan(nearDuration * 2);
    advance(b, 0.9);
    expect(knight.hp).toBe(10000);
    advance(b, 0.2);
    expect(knight.hp).toBe(10000 - CARD_MAP.fireball.damage);
    expect(knight.y).toBeCloseTo(22.8);
    expect([giant.x, giant.y]).toEqual([10.5, 20]);
    expect(friend.hp).toBe(10000);
    expect([friend.x, friend.y]).toEqual([7.5, 20]);
  });
  it("Arrows resolve three separate waves across 0.4 seconds", () => {
    const b = sandbox(),
      target = dummy(b, "knight", "red", 9, 20);
    cast(b, "arrows", "blue", 9, 20);
    advance(b, 0.8);
    expect(target.hp).toBe(10000 - 122);
    advance(b, 0.2);
    expect(target.hp).toBe(10000 - 244);
    advance(b, 0.2);
    expect(target.hp).toBe(10000 - 366);
    expect(
      b.events.filter((e) => e.type === "hit" && e.card === "arrows"),
    ).toHaveLength(3);
  });
});

describe("Tesla hiding and emergence", () => {
  it("stays hidden without enemies and ignores damage spells while its lifetime decays", () => {
    const b = sandbox(),
      tesla = unit(b, "tesla", "blue", 9, 21),
      hp = tesla.hp;
    cast(b, "fireball", "red", 9, 21);
    cast(b, "arrows", "red", 9, 21);
    cast(b, "zap", "red", 9, 21);
    advance(b, 3);
    expect(tesla.burrow?.phase).toBe("hidden");
    expect(tesla.hp).toBeCloseTo(hp - (hp / tesla.lifetime!) * 3);
    expect(tesla.stun).toBe(0);
    expect(tesla.target).toBeNull();
  });
  it.each(["knight", "minions"] as CardId[])(
    "emerges before attacking a nearby %s",
    (id) => {
      const b = sandbox(),
        tesla = unit(b, "tesla", "blue", 9, 21);
      const target = dummy(b, id, "red", 9, 24);
      advance(b, 0.4);
      expect(tesla.burrow?.phase).toBe("rising");
      expect(tesla.burrow?.exposure).toBeCloseTo(0.5);
      expect(target.hp).toBe(10000);
      advance(b, 0.4);
      expect(tesla.burrow?.phase).toBe("exposed");
      expect(target.hp).toBe(10000);
      advance(b, 0.8);
      expect(target.hp).toBe(10000 - tesla.damage);
    },
  );
  it("cannot attract a Giant until it begins to emerge", () => {
    const b = sandbox(),
      tesla = unit(b, "tesla", "blue", 9, 21);
    const giant = unit(b, "giant", "red", 9, 12);
    b.step();
    expect(tesla.burrow?.phase).toBe("hidden");
    expect(giant.target).not.toBe(tesla.id);
    giant.x = 9;
    giant.y = 19;
    b.step();
    expect(tesla.burrow?.phase).toBe("rising");
    expect(giant.target).toBe(tesla.id);
  });
  it("retracts after enemies leave and reverses smoothly if they return", () => {
    const b = sandbox(),
      tesla = unit(b, "tesla", "blue", 9, 21);
    const target = dummy(b, "knight", "red", 9, 24);
    advance(b, 0.8);
    target.y = 10;
    advance(b, 0.5);
    expect(tesla.burrow?.exposure).toBe(1);
    advance(b, 0.7);
    expect(tesla.burrow?.phase).toBe("sinking");
    const exposure = tesla.burrow!.exposure;
    expect(exposure).toBeGreaterThan(0);
    expect(exposure).toBeLessThan(1);
    target.y = 24;
    b.step();
    expect(tesla.burrow?.phase).toBe("rising");
    expect(tesla.burrow!.exposure).toBeGreaterThan(exposure);
    expect(tesla.burrow!.exposure).toBeLessThan(1);
    target.y = 10;
    advance(b, 2);
    expect(tesla.burrow?.phase).toBe("hidden");
    expect(tesla.burrow?.exposure).toBe(0);
  });
  it("takes spell damage and stun while exposed, then freezes its rise during the stun", () => {
    const b = sandbox(),
      tesla = unit(b, "tesla", "blue", 9, 21);
    dummy(b, "knight", "red", 9, 24);
    advance(b, 0.2);
    const hp = tesla.hp;
    cast(b, "zap", "red", 9, 21);
    advance(b, 0.2);
    expect(tesla.hp).toBeCloseTo(
      hp - CARD_MAP.zap.damage - (tesla.maxHp / tesla.lifetime!) * 0.2,
    );
    expect(tesla.stun).toBeGreaterThan(0);
    const exposure = tesla.burrow!.exposure;
    advance(b, 0.2);
    expect(tesla.burrow?.exposure).toBe(exposure);
  });
  it("expires underground without awarding a crown", () => {
    const b = sandbox(),
      tesla = unit(b, "tesla", "blue", 9, 21);
    advance(b, CARD_MAP.tesla.lifetime! + 1);
    expect(b.entities.some((e) => e.id === tesla.id)).toBe(false);
    expect(b.players.red.crowns).toBe(0);
  });
  it("replays hiding, deployment and spell commands deterministically", () => {
    const source = new Battle({
      seed: 91,
      deck: combatV2.replay.deck as CardId[],
    });
    for (let i = 0; i < 5400 && !source.winner; i++) {
      if (i % 110 === 0) source.play("blue", Math.floor(i / 110) % 4, 8, 21);
      source.step();
    }
    expect(source.actions.some((a) => a.card === "tesla")).toBe(true);
    const replay = new Battle({ replay: source.exportReplay() });
    for (let i = 0; i < source.tick; i++) replay.step();
    expect(replay.entities).toEqual(source.entities);
    expect(replay.projectiles).toEqual(source.projectiles);
    expect(replay.players).toEqual(source.players);
    expect(replay.events).toEqual(source.events);
  });
});

describe("versioned battle replay", () => {
  it("retains v5 Bomber, Arrows, Goblins and Skeletons rules", () => {
    const old = new Battle({ replay: {
      version: 5,
      seed: 8,
      mode: "classic",
      deck: STARTER_DECK,
      enemyDeck: STARTER_DECK,
      actions: [],
      duration: 0,
    } });
    old.players.blue.hand[0] = "bomber";
    expect(old.cardCost("blue", "bomber")).toBe(2);
    expect(old.play("blue", 0, 4, 22).ok).toBe(true);
    expect(old.players.blue.elixir).toBe(3);
    old.players.blue.hand[0] = "goblins";
    old.players.blue.elixir = 10;
    expect(old.play("blue", 0, 6, 22).ok).toBe(true);
    expect(old.entities.filter((e) => e.card === "goblins")).toHaveLength(4);
    old.players.red.hand[0] = "skeletons";
    expect(old.play("red", 0, 4, 10).ok).toBe(true);
    expect(old.entities.filter((e) => e.card === "skeletons")).toHaveLength(3);
    old.players.blue.hand[0] = "arrows";
    expect(old.play("blue", 0, 9, 22).ok).toBe(true);
    expect(old.projectiles.filter((p) => p.style === "arrows").every((p) => p.splash === 3.6)).toBe(true);
  });
  it("preserves the captured v4 match with delayed King activation and immediate finish order", () => {
    const b = new Battle({ replay: combatV4.replay as Replay });
    for (let i = 0; i < combatV4.replay.duration; i++) b.step();
    expect(
      JSON.parse(
        JSON.stringify({
          tick: b.tick,
          winner: b.winner,
          players: b.players,
          entities: b.entities,
          projectiles: b.projectiles,
        }),
      ),
    ).toEqual(combatV4.state);
    expect(b.exportReplay().version).toBe(4);
  });
  it("preserves the captured v3 match with immediate King activation", () => {
    const b = new Battle({ replay: combatV3.replay as Replay });
    for (let i = 0; i < combatV3.replay.duration; i++) b.step();
    expect(
      JSON.parse(
        JSON.stringify({
          tick: b.tick,
          winner: b.winner,
          players: b.players,
          entities: b.entities,
          projectiles: b.projectiles,
        }),
      ),
    ).toEqual(combatV3.state);
    expect(b.exportReplay().version).toBe(3);
  });
  it("preserves v2 Tesla combat and the complete captured final state", () => {
    const b = new Battle({ replay: combatV2.replay as Replay });
    for (let i = 0; i < combatV2.replay.duration; i++) b.step();
    expect(
      JSON.parse(
        JSON.stringify({
          tick: b.tick,
          winner: b.winner,
          players: b.players,
          entities: b.entities,
          projectiles: b.projectiles,
        }),
      ),
    ).toEqual(combatV2.state);
    expect(b.exportReplay().version).toBe(2);
  });
  it("reproduces the frozen v1 battle down to all saved state fields", () => {
    const b = new Battle({ replay: legacy.replay as Replay });
    for (let i = 0; i < legacy.replay.duration; i++) b.step();
    expect(
      JSON.parse(
        JSON.stringify({
          tick: b.tick,
          winner: b.winner,
          players: b.players,
          entities: b.entities,
          projectiles: b.projectiles,
        }),
      ),
    ).toEqual(legacy.state);
    expect(b.exportReplay().version).toBe(1);
  });
  it("records current commands that reproduce the complete match and pending attacks", () => {
    const b = new Battle({ seed: 90 });
    for (let i = 0; i < 9000 && !b.winner; i++) {
      if (i % 130 === 0) b.play("blue", i % 4, 4, 21);
      b.step();
    }
    expect(b.winner).not.toBeNull();
    const record = b.exportReplay();
    expect(record.version).toBe(15);
    const replay = new Battle({ replay: record });
    for (let i = 0; i < record.duration; i++) replay.step();
    expect(replay.winner).toEqual(b.winner);
    expect(replay.entities).toEqual(b.entities);
    expect(replay.players).toEqual(b.players);
    expect(replay.projectiles).toEqual(b.projectiles);
    expect(replay.events).toEqual(b.events);
  });
});

describe("King Tower activation", () => {
  function setup() {
    const b = sandbox();
    const king = b.entities.find((e) => e.king && e.team === "red")!;
    dummy(b, "knight", "blue", 9, 7);
    return { b, king };
  }
  function wake(b: Battle, king: Entity, x = king.x, y = king.y) {
    cast(b, "zap", "blue", x, y);
    for (let i = 0; i < 15 && !king.active; i++) b.step();
    expect(king.active).toBe(true);
  }
  it("uses the archived 3.3-second wake delay before starting its first attack", () => {
    const { b, king } = setup();
    advance(b, 1);
    expect(king.active).toBe(false);
    expect(b.projectiles.some((p) => p.source === king.id)).toBe(false);
    wake(b, king);
    expect(KING_ACTIVATION_TIME).toBe(3.3);
    expect(king.activation).toBe(KING_ACTIVATION_TIME);
    advance(b, KING_ACTIVATION_TIME - STEP);
    expect(king.activation).toBeCloseTo(STEP);
    expect(king.pendingAttack).toBeUndefined();
    expect(b.projectiles.some((p) => p.source === king.id)).toBe(false);
    b.step();
    expect(king.activation).toBe(0);
    expect(king.pendingAttack).toBeUndefined();
    b.step();
    expect(king.pendingAttack?.remaining).toBe(combatTraits(king).windup);
    const started = b.time;
    const shot = awaitShot(b, king);
    expect(shot.source).toBe(king.id);
    expect(b.time - started).toBeCloseTo(combatTraits(king).windup);
  });
  it("starts waking when a Princess Tower falls without losing King health", () => {
    const { b, king } = setup();
    const princess = b.entities.find(
      (e) => e.team === "red" && e.kind === "tower" && !e.king,
    )!;
    princess.hp = 1;
    wake(b, king, princess.x, princess.y);
    expect(king.hp).toBe(king.maxHp);
    expect(king.activation).toBe(KING_ACTIVATION_TIME);
    expect(b.players.blue.crowns).toBe(1);
  });
  it("repeated damage does not restart the wake sequence", () => {
    const { b, king } = setup();
    wake(b, king);
    advance(b, 1);
    const before = king.activation!;
    cast(b, "zap", "blue", king.x, king.y);
    advance(b, 0.5);
    expect(king.activation).toBeCloseTo(before - 0.5);
    advance(b, 3);
    expect(king.activation).toBe(0);
    cast(b, "zap", "blue", king.x, king.y);
    advance(b, 0.5);
    expect(king.activation).toBe(0);
  });
  it("a King killed while waking never launches a shot", () => {
    const { b, king } = setup();
    wake(b, king);
    king.hp = 1;
    cast(b, "zap", "blue", king.x, king.y);
    advance(b, 1);
    expect(b.winner).toBe("blue");
    expect(b.players.blue.crowns).toBe(3);
    expect(b.projectiles.some((p) => p.source === king.id)).toBe(false);
  });
});
