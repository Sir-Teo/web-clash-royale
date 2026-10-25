import { describe, expect, it } from "vitest";
import { cardDetails } from "../src/ui/card-details";
import { CARDS, CARD_MAP, type CardId } from "../src/game/cards";
import { Battle } from "../src/game/engine";
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
    for (const c of CARDS.filter((c) => c.kind === "troop" && c.count > 1)) {
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
