import { describe, expect, it } from "vitest";
import { cardDetails } from "../src/ui/card-details";
import { CARDS, CARD_MAP, type CardId } from "../src/game/cards";
import { Battle, STEP, type Entity } from "../src/game/engine";
import rage from "../src/game/rage-data.json";

const rows = (id: CardId) =>
  Object.fromEntries(
    cardDetails(id).stats.map((row) => [row.label, row.value]),
  );
const numeric = (text: string) => Number(text.replaceAll(",", ""));
function cast(id: CardId, x = 4, y = 6) {
  const battle = new Battle({ seed: 4, ai: false });
  for (const e of battle.entities) e.active = false;
  battle.players.blue.hand[0] = id;
  battle.players.blue.elixir = 10;
  expect(battle.play("blue", 0, x, y).ok).toBe(true);
  return battle;
}

describe("current card detail stats", () => {
  it("gives every supported card unique useful rows and its actual cost", () => {
    for (const c of CARDS) {
      const stats = cardDetails(c.id).stats;
      expect(new Set(stats.map((row) => row.label)).size).toBe(stats.length);
      expect(stats.length).toBeGreaterThanOrEqual(c.id === "mirror" ? 2 : c.kind === "spell" ? 5 : 6);
      expect(
        stats.every(
          (row) => row.value && !/NaN|undefined|Infinity/.test(row.value),
        ),
      ).toBe(true);
      expect(rows(c.id).Elixir).toBe(c.id === "mirror" ? "Previous card + 1" : String(c.cost));
      expect(rows(c.id)).not.toHaveProperty("Area damage");
    }
  });
  it("identifies swarm health and damage as per troop rather than a combined pool", () => {
    for (const c of CARDS.filter((c) => c.kind === "troop" && c.count > 1 && c.id !== "goblin-gang")) {
      expect(numeric(rows(c.id)["Hitpoints per troop"])).toBe(c.hp);
      expect(numeric(rows(c.id)["Damage per troop"])).toBe(c.damage);
      expect(rows(c.id).Count).toBe(String(c.count));
    }
    expect(rows("minion-horde")).toMatchObject({
      "Hitpoints per troop": "230",
      "Damage per troop": "102",
      "Hit interval": "1 s",
      Count: "6",
    });
  });
  it("distinguishes Goblin Gang's two troop types using their actual deployed bodies", () => {
    const battle = cast("goblin-gang", 4, 22);
    const stats = rows("goblin-gang");
    const bodies = battle.entities.filter((e) => e.team === "blue" && e.kind === "troop");
    expect(numeric(stats.Count)).toBe(bodies.length);
    battle.players.red.hand[0] = "minions";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const air = battle.entities.find((e) => e.team === "red" && e.card === "minions")!;
    for (const [card, name, group] of [
      ["goblins", "Goblin", "Goblins"],
      ["spear-goblins", "Spear Goblin", "Spear Goblins"],
    ] as const) {
      const troops = bodies.filter((e) => e.card === card);
      expect(numeric(stats[group])).toBe(troops.length);
      expect(troops.length).toBeGreaterThan(0);
      for (const troop of troops) {
        expect(numeric(stats[`${name} hitpoints`])).toBe(troop.maxHp);
        expect(numeric(stats[`${name} damage`])).toBe(troop.damage);
        expect(parseFloat(stats[`${name} hit interval`])).toBe(troop.interval);
        expect(parseFloat(stats[`${name} range`])).toBe(troop.range);
        expect(stats[`${name} targets`]).toBe((battle as any).validTarget(troop, air) ? "Air & ground" : "Ground");
      }
    }
    expect(stats["Goblin hitpoints"]).not.toBe(stats["Spear Goblin hitpoints"]);
    expect(stats["Goblin damage"]).not.toBe(stats["Spear Goblin damage"]);
    for (const label of ["Hitpoints per troop", "Damage per troop", "Targets", "Range", "Hit interval"])
      expect(stats).not.toHaveProperty(label);
    expect(cardDetails("goblin-gang").note).toContain("per troop of the named type");
  });
  it.each([
    ["inferno-tower", "normal"], ["inferno-tower", "rage"], ["inferno-tower", "slow"],
    ["inferno-dragon", "normal"], ["inferno-dragon", "rage"], ["inferno-dragon", "slow"],
  ] as const)("matches %s stage details to actual %s beam hits, lock clocks and resets", (id, buff) => {
    const battle = cast(id, 4, 22);
    const beam = battle.entities.find((entity) => entity.card === id)!;
    beam.deploy = 0;
    if (buff === "rage") beam.rage = { remaining: 30 };
    if (buff === "slow") beam.slow = { remaining: 30 };
    battle.players.red.hand[0] = "knight";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    const target = battle.entities.find((entity) => entity.team === "red" && entity.card === "knight")!;
    Object.assign(target, { x: 4, y: 18, deploy: 0, active: false, hp: 100000, maxHp: 100000 });
    const stats = rows(id), stages = new Map<number, number>();
    for (let step = 0; step < 160; step++) {
      battle.step();
      const stage = beam.inferno?.stage;
      if (stage !== undefined && !stages.has(stage)) stages.set(stage, battle.time);
    }
    const damage = battle.events.filter((event) => event.type === "hit" && event.card === id).map((event) => event.value);
    for (const stage of [1, 2, 3]) expect(damage).toContain(numeric(stats[`Stage ${stage} damage`]));
    expect(numeric(stats["Stage 1 damage"])).toBe(CARD_MAP[id].damage);
    for (const stage of [2, 3])
      expect(Math.abs(stages.get(stage - 1)! - parseFloat(stats[`Stage ${stage} after`]))).toBeLessThanOrEqual(STEP + 1e-8);
    expect(stats).not.toHaveProperty("Damage per hit");
    battle.players.red.hand[0] = "zap";
    battle.players.red.elixir = 10;
    expect(battle.play("red", 0, beam.x, beam.y).ok).toBe(true);
    for (let step = 0; step < 10 && beam.stun === 0; step++) battle.step();
    expect(beam.stun).toBeGreaterThan(0);
    expect(beam.inferno).toBeUndefined();
    for (let step = 0; step < 30 && !beam.inferno; step++) battle.step();
    expect(beam.inferno?.stage).toBe(0);
    target.y = beam.y - 20;
    battle.step();
    expect(beam.inferno).toBeUndefined();
    expect(cardDetails(id).note).toContain("losing range or changing targets resets");
  });
  it("describes individual troops and defensive buildings with their actual interval and lifetime", () => {
    expect(rows("knight")).toMatchObject({
      Hitpoints: "1,666",
      "Damage per hit": "202",
      "Hit interval": "1.1 s",
      Targets: "Ground",
    });
    expect(rows("cannon")).toMatchObject({
      Hitpoints: "824",
      "Damage per hit": "175",
      Lifetime: "30 s",
      Targets: "Ground",
    });
    expect(rows("tesla")).toMatchObject({
      Lifetime: `${CARD_MAP.tesla.lifetime} s`,
      Targets: "Air & ground",
    });
    expect(rows("cannon")).not.toHaveProperty("Count");
  });
  it.each([
    ["golem", "golemite", "Golemite"],
    ["lava-hound", "lava-pup", "Lava Pup"],
    ["battle-ram", "barbarians", "Barbarian"],
    ["night-witch", "bats", "Bat"],
  ] as const)("matches %s death-spawn details to actual released troops", (id, childId, name) => {
    const battle = cast(id, 4, 22);
    const parent = battle.entities.find((e) => e.card === id)!;
    const stats = rows(id);
    expect(parseFloat(stats["Deploy time"])).toBe(parent.deploy);
    (battle as any).hurt(parent, parent.hp);
    const children = battle.entities.filter((e) => e.card === childId);
    expect(children.length).toBeGreaterThan(0);
    expect(stats["On destruction"]).toBe(`${children.length} ${name}s`);
    for (const child of children) {
      expect(numeric(stats["Spawn hitpoints"])).toBe(child.maxHp);
      expect(numeric(stats["Spawn damage per hit"])).toBe(child.damage);
      expect(parseFloat(stats["Spawn hit interval"])).toBe(child.interval);
      expect(parseFloat(stats["Spawn deploy time"])).toBe(child.deploy);
    }
    for (const card of ["knight", "minions"] as const) {
      battle.players.red.hand[0] = card;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 4, 10).ok).toBe(true);
    }
    const valid = (card: CardId | "tower") => (battle as any).validTarget(
      children[0], battle.entities.find((e) => e.team === "red" && e.card === card),
    );
    expect(valid("tower")).toBe(true);
    expect(stats["Spawn targets"]).toBe(!valid("knight") ? "Buildings" :
      valid("minions") ? "Air & ground" : "Ground");
    expect(cardDetails(id).note).toContain("per troop");
  });

  it("shows both Golem death blasts separately from the living troops' attacks", () => {
    const battle = cast("golem", 4, 22);
    const stats = rows("golem");
    for (const [card, damageLabel, radiusLabel] of [
      ["golem", "Death damage", "Death radius"],
      ["golemite", "Golemite death damage", "Golemite death radius"],
    ] as const) {
      const source = battle.entities.find((e) => e.card === card && e.hp > 0)!;
      const victims: Entity[] = [];
      for (const outside of [false, true]) {
        battle.players.red.hand[0] = "knight";
        battle.players.red.elixir = 10;
        expect(battle.play("red", 0, 4, 10).ok).toBe(true);
        const victim = battle.entities.filter((e) => e.card === "knight").at(-1)!;
        Object.assign(victim, {
          x: source.x + parseFloat(stats[radiusLabel]) + victim.radius + (outside ? 0.1 : -0.1),
          y: source.y, hp: 10000, maxHp: 10000,
        });
        victims.push(victim);
      }
      (battle as any).hurt(source, source.hp);
      expect(10000 - victims[0].hp).toBe(numeric(stats[damageLabel]));
      expect(victims[1].hp).toBe(10000);
    }
  });

  it("matches Night Witch's first and repeating Bat waves to the displayed clocks", () => {
    const battle = cast("night-witch", 4, 22);
    const stats = rows("night-witch");
    const waves: number[] = [];
    const counts: number[] = [];
    for (let tick = 0; tick < 400 && waves.length < 2; tick++) {
      const before = battle.entities.filter((e) => e.card === "bats").length;
      battle.step();
      const born = battle.entities.filter((e) => e.card === "bats").length - before;
      if (born > 0) {
        waves.push(battle.time);
        counts.push(born);
      }
    }
    expect(waves).toHaveLength(2);
    expect(Math.abs(waves[0] - parseFloat(stats["Deploy time"]) -
      parseFloat(stats["First spawn delay"]))).toBeLessThanOrEqual(2 * STEP);
    expect(waves[1] - waves[0]).toBeCloseTo(parseFloat(stats["Spawn interval"]), 8);
    expect(counts.map((count) => `${count} Bats`)).toEqual([stats.Spawns, stats.Spawns]);
  });

  it("describes Collector production using its actual first collection and repeat interval", () => {
    const battle = cast("elixir-collector", 4, 22);
    const collector = battle.entities.find((e) => e.card === "elixir-collector")!;
    const stats = rows("elixir-collector");
    expect(numeric(stats.Hitpoints)).toBe(collector.hp);
    expect(parseFloat(stats["Deploy time"])).toBe(collector.deploy);
    expect(parseFloat(stats.Lifetime)).toBe(CARD_MAP[collector.card].lifetime);
    const collections: number[] = [];
    for (let tick = 0; tick < 600 && collections.length < 2; tick++) {
      const count = battle.audioEvents.filter((e) => e.phase === "collect").length;
      const before = battle.players.blue.elixir = 0;
      battle.step();
      if (battle.audioEvents.filter((e) => e.phase === "collect").length > count) {
        collections.push(battle.time);
        expect(battle.players.blue.elixir - before - STEP / 2.8)
          .toBeCloseTo(numeric(stats["Elixir per cycle"]), 8);
      }
    }
    expect(collections).toHaveLength(2);
    expect(Math.abs(collections[0] - parseFloat(stats["Deploy time"]) -
      parseFloat(stats["Production interval"]))).toBeLessThanOrEqual(2 * STEP);
    expect(collections[1] - collections[0]).toBeCloseTo(parseFloat(stats["Production interval"]), 8);
    expect(cardDetails("elixir-collector").note).toContain("capped at 10");
    expect(stats).not.toHaveProperty("Damage per hit");
  });

  it.each([
    ["goblin-hut", "spear-goblins", "1 Spear Goblin", 1],
    ["tombstone", "skeletons", "1 Skeleton", 1],
    ["furnace", "fire-spirits", "2 Fire Spirits", 2],
    ["barbarian-hut", "barbarians", "2 Barbarians", 2],
  ] as const)("matches %s details to troop births and wave timing", (id, troop, description, count) => {
    const battle = cast(id, 4, 22);
    const building = battle.entities.find((e) => e.card === id)!;
    const stats = rows(id);
    expect(numeric(stats.Hitpoints)).toBe(building.hp);
    expect(parseFloat(stats["Deploy time"])).toBe(building.deploy);
    expect(parseFloat(stats.Lifetime)).toBe(CARD_MAP[id].lifetime);
    expect(stats.Spawns).toBe(description);
    const births: number[] = [];
    for (let tick = 0; tick < 1000 && births.length < count + 1; tick++) {
      const previousId = battle.entities.at(-1)!.id;
      battle.step();
      for (const unit of battle.entities.filter((e) => e.id > previousId && e.card === troop)) {
        births.push(battle.time);
        expect(unit.deploy).toBeCloseTo(parseFloat(stats["Troop deploy time"]), 8);
      }
    }
    expect(births).toHaveLength(count + 1);
    expect(Math.abs(births[0] - parseFloat(stats["Deploy time"]) -
      parseFloat(stats["First spawn delay"]))).toBeLessThanOrEqual(2 * STEP);
    expect(Math.abs(births[count] - births[0] -
      parseFloat(stats[count === 2 ? "Wave interval" : "Spawn interval"])))
      .toBeLessThanOrEqual(STEP);
    if (count === 2)
      expect(births[1] - births[0]).toBeCloseTo(parseFloat(stats["Troop spacing"]), 8);
    for (const label of ["Damage per hit", "Hit interval", "Range", "Targets"])
      expect(stats).not.toHaveProperty(label);
    if (id === "tombstone") {
      const previous = battle.entities.filter((e) => e.card === troop).length;
      (battle as any).hurt(building, building.hp);
      expect(battle.entities.filter((e) => e.card === troop).length - previous)
        .toBe(parseFloat(stats["On destruction"]));
      expect(stats["On destruction"]).toBe("4 Skeletons");
      expect(cardDetails(id).note).toContain("when its lifetime expires");
    }
  });
  it.each(["fireball", "arrows", "zap", "rocket"] as const)(
    "matches a real %s Crown Tower impact without rounding damage to a whole hitpoint",
    (id) => {
      const battle = cast(id);
      const tower = battle.entities.find(
        (e) => e.team === "red" && e.lane === "left",
      )!;
      const before = tower.hp;
      for (let i = 0; i < 600 && battle.projectiles.length; i++) battle.step();
      expect(battle.projectiles).toHaveLength(0);
      const stats = rows(id);
      expect(numeric(stats[id === "arrows" ? "Volley damage" : "Damage"])).toBe(
        CARD_MAP[id].damage,
      );
      expect(before - tower.hp).toBeCloseTo(
        numeric(stats["Crown Tower damage"]),
        8,
      );
      if (id === "arrows") {
        expect(stats.Waves).toBe("1");
        expect(cardDetails(id).note).toBe("A single flight of 15 arrows deals the full volley damage once.");
      }
      if (id === "zap") expect(stats.Stun).toBe("0.5 s");
    },
  );
  it("uses normalized Poison ticks and duration consumed by the simulation", () => {
    const battle = cast("poison");
    (battle as any).spawn("knight", "red", 4, 6);
    const unit = battle.entities.at(-1)!;
    unit.active = false;
    unit.deploy = 0;
    const tower = battle.entities.find(
      (e) => e.team === "red" && e.lane === "left",
    )!;
    const unitHp = unit.hp,
      towerHp = tower.hp;
    for (let i = 0; i < 60 && unit.hp === unitHp; i++) battle.step();
    expect(unitHp - unit.hp).toBeCloseTo(
      numeric(rows("poison")["Damage per second"]),
      8,
    );
    expect(towerHp - tower.hp).toBeCloseTo(
      numeric(rows("poison")["Crown Tower / second"]),
      8,
    );
    expect(rows("poison")).toMatchObject({
      "Damage per second": "121",
      "Crown Tower / second": "48.4",
      Duration: "8 s",
      Linger: "Up to 1 s",
    });
  });
  it("shows Freeze's area duration and hidden-building effect instead of zero damage", () => {
    const battle = cast("freeze");
    expect(rows("freeze")).toMatchObject({
      Effect: "Freeze",
      Duration: `${battle.areas[0].duration} s`,
      Radius: `${battle.areas[0].radius} tiles`,
      "Hidden Tesla": "Affected",
    });
    expect(rows("freeze")).not.toHaveProperty("Damage");
  });
  it("shows Rage's friendly boost and its capped lingering time", () => {
    const battle = cast("rage");
    expect(rage.hitSpeedMultiplier).toBe(rage.speedMultiplier);
    expect(rage.spawnSpeedMultiplier).toBe(rage.speedMultiplier);
    expect(rage.capBuffToAreaTime).toBe(true);
    expect(rows("rage")).toMatchObject({
      "Speed boost": "+35%",
      Duration: `${battle.areas[0].duration} s`,
      Linger: "Up to 2 s",
      Targets: "Friendly air & ground troops",
    });
    expect(cardDetails("rage").note).toContain("ends when the area expires");
    expect(cardDetails("rage").note).toContain("Buildings and Crown Towers are unaffected");
    expect(rows("rage")).not.toHaveProperty("Damage");
  });

  it.each(["prince", "dark-prince", "battle-ram"] as const)(
    "shows %s charge distance and the damage from a real charged attack",
    (id) => {
      const battle = new Battle({ seed: 4, ai: false });
      battle.entities.forEach((e) => (e.active = false));
      (battle as any).spawn(id, "blue", 4, 23);
      const unit = battle.entities.at(-1)!;
      Object.assign(unit, { deploy: 0, cooldown: 0, speed: 0,
        chargeDistance: id === "battle-ram" ? 3 : 2.5 });
      const target = battle.entities.find((e) => e.team === "red" && !e.king)!;
      Object.assign(target, { x: 4, y: 22, hp: 10000, maxHp: 10000 });
      expect(rows(id)["Charge distance"]).toBe(`${unit.chargeDistance} tiles`);
      battle.step();
      expect(unit.pendingAttack?.damage).toBe(numeric(rows(id)["Charge damage"]));
      expect(cardDetails(id).note).toContain("doubling movement speed");
      expect(cardDetails(id).note).toContain("Stun resets the charge");
    },
  );

  it.each(["guards", "dark-prince"] as const)(
    "shows %s shield health separately and matches a native breaking hit",
    (id) => {
      const battle = new Battle({ seed: 4, ai: false });
      battle.entities.forEach((e) => (e.active = false));
      battle.players.red.hand[0] = id;
      battle.players.red.elixir = 10;
      expect(battle.play("red", 0, 9, 10).ok).toBe(true);
      const units = battle.entities.filter((e) => e.card === id);
      for (const unit of units)
        Object.assign(unit, { active: false, deploy: 0 });
      expect(units).toHaveLength(CARD_MAP[id].count);
      const stats = rows(id);
      for (const unit of units) {
        expect(
          numeric(
            stats[id === "guards" ? "Shield per troop" : "Shield hitpoints"],
          ),
        ).toBe(unit.shield);
        expect(unit.maxShield).toBe(unit.shield);
        expect(
          numeric(stats[id === "guards" ? "Hitpoints per troop" : "Hitpoints"]),
        ).toBe(unit.hp);
      }
      expect(cardDetails(id).note).toContain(
        "A hit that breaks the shield does not damage the body.",
      );
      const blast = (card: "fireball" | "zap") => {
        battle.players.blue.hand[0] = card;
        battle.players.blue.elixir = 10;
        expect(battle.play("blue", 0, 9, 10).ok).toBe(true);
        let ticks = 0;
        while (battle.projectiles.length && ticks++ < 150) battle.step();
        expect(battle.projectiles).toHaveLength(0);
      };
      blast("fireball");
      for (const unit of units) {
        expect(unit.shield).toBe(0);
        expect(unit.hp).toBe(CARD_MAP[id].hp);
      }
      blast("zap");
      for (const unit of units)
        expect(unit.hp).toBe(
          Math.max(0, CARD_MAP[id].hp - CARD_MAP.zap.damage),
        );
    },
  );

  it("keeps shield statistics out of cards that have no starting shield", () => {
    for (const card of CARDS.filter(
      (c) => !["guards", "dark-prince"].includes(c.id),
    )) {
      expect(rows(card.id)).not.toHaveProperty("Shield hitpoints");
      expect(rows(card.id)).not.toHaveProperty("Shield per troop");
    }
  });
});
