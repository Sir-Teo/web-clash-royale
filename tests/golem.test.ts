import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_MAP, CARDS, STARTER_DECK } from "../src/game/cards";
import { Battle } from "../src/game/engine";
import type { Entity } from "../src/game/engine";
import { combatAudioPlan } from "../src/game/combat-audio";
import { perspective, snapshot } from "../src/network/perspective";
import { deathAudioPlan } from "../src/game/death-audio";
import { deathEffect, destructionPlan } from "../src/render/destruction";
import rules from "../src/game/golem-data.json";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const gameWithGolem = () => {
  const game = new Battle({ seed: 59, ai: false,
    deck: ["golem", ...STARTER_DECK.filter((id) => id !== "arrows")] });
  for (const tower of game.entities) tower.active = false;
  game.players.blue.hand[0] = "golem";
  game.players.blue.elixir = 10;
  expect(game.play("blue", 0, 4, 22).ok).toBe(true);
  const golem = game.entities.find((e) => e.card === "golem")!;
  Object.assign(golem, { x: 4, y: 21, deploy: 0, speed: 0 });
  return { game, golem };
};
const opponent = (game: Battle, card: "knight" | "minions", x: number, y: number) => {
  game.players.red.hand[0] = card;
  game.players.red.elixir = 10;
  expect(game.play("red", 0, 4, 10).ok).toBe(true);
  const enemy = game.entities.filter((e) => e.team === "red" && e.card === card).at(-1)!;
  Object.assign(enemy, { x, y, deploy: 0, active: false, speed: 0, damage: 0,
    hp: 10000, maxHp: 10000 });
  return enemy;
};
const damage = (game: Battle, entity: Entity, amount: number) =>
  (game as unknown as { hurt: (entity: Entity, amount: number) => void }).hurt(entity, amount);

describe("archived Golem and Golemites", () => {
  it("pins the original card and both native character models, effects and sounds", () => {
    const manifest = json("reference/client/golem-manifest.json");
    for (const input of manifest.inputs) expect(hash(input.path)).toBe(input.sha256);
    expect(hash(manifest.output.path)).toBe(manifest.output.sha256);
    expect(rules).toMatchObject({ card: "Golem", rarity: "Epic", cost: 8,
      golem: { sourceHitpoints: 3200, sourceDamage: 195,
        sourceDeployTime: 3, sourceHitSpeed: 2.5, targetsBuildings: true,
        ignoresPushback: true, death: { damage: 195, radius: 2,
          pushback: 1.8, hitsAir: true },
        deathSpawn: { character: "Golemite", count: 2, radius: 1.5 } },
      golemite: { sourceHitpoints: 650, sourceDamage: 40,
        targetsBuildings: true, death: { damage: 40, radius: 2,
          pushback: 1.8, hitsAir: true } } });
    expect(CARDS).toHaveLength(74);
    expect(CARDS.some((card) => card.id === "golemite")).toBe(false);
    expect(CARD_MAP.golem).toMatchObject({ cost: 8, hp: 5154, damage: 314,
      buildingsOnly: true });
    expect(CARD_MAP.golemite).toMatchObject({ hp: 1047, damage: 64,
      buildingsOnly: true });
    const models = json("public/assets/animations/manifest.json").files;
    for (const [id, source] of [["golem", "chr_golem"], ["golemite", "chr_golemite"]]) {
      const model = models.find((file: { id: string }) => file.id === id);
      expect(model.clips).toBe(54);
      expect(model.metadataSha256).toBe(hash(`reference/sc/${source}.bin`));
      expect(deathEffect(id)).toBe(id);
      expect(destructionPlan(id as "golem" | "golemite", 7).length).toBeGreaterThan(0);
      expect(deathAudioPlan(id, 7).length).toBeGreaterThan(0);
      expect(combatAudioPlan(id as "golem" | "golemite", "spawn", 7).length).toBeGreaterThan(0);
    }
    expect(json("public/assets/ui/cards/cards.json").portraits.golem.row).toBe("Golem");
    expect(() => new Battle({ deck: ["golemite", ...STARTER_DECK.filter((id) => id !== "knight")] }))
      .toThrow("eight unique valid cards");
  });

  it("waits three seconds to deploy and ignores troops on the way to a building", () => {
    const { game, golem } = gameWithGolem();
    golem.deploy = rules.golem.sourceDeployTime;
    opponent(game, "knight", 4, 19);
    for (let i = 0; i < 89; i++) game.step();
    expect(golem.target).toBeNull();
    game.step();
    expect(golem.deploy).toBeLessThan(1e-8);
    for (let i = 0; i < 3 && golem.target === null; i++) game.step();
    expect(game.entities.find((e) => e.id === golem.target)?.kind).toBe("tower");
  });

  it("explodes against ground and air, pushes survivors, and splits into two peer-visible Golemites", () => {
    const { game, golem } = gameWithGolem();
    const knight = opponent(game, "knight", 4, 20);
    const minion = opponent(game, "minions", 4.5, 20);
    const distant = opponent(game, "knight", 9, 20);
    const blast = Math.round(rules.golem.death.damage * 1.1 ** 5);
    golem.hp = 1;
    damage(game, golem, 1);
    expect(knight.hp).toBe(10000 - blast);
    expect(minion.hp).toBe(10000 - blast);
    expect(distant.hp).toBe(10000);
    expect(knight.y).toBeLessThan(20);
    expect(minion.x).toBeGreaterThan(4.5);
    const children = game.entities.filter((e) => e.card === "golemite" && e.team === "blue");
    expect(children).toHaveLength(2);
    expect(children.every((e) => e.hp === CARD_MAP.golemite.hp && e.deploy === 1)).toBe(true);
    expect(children.map((e) => e.x).sort()).toEqual([3.25, 4.75]);
    expect(game.audioEvents.filter((e) => e.profile === "golemite" && e.phase === "spawn"))
      .toHaveLength(2);
    const guest = perspective(snapshot(game), "red");
    expect(guest.entities.filter((e) => e.card === "golemite" && e.team === "red"))
      .toHaveLength(2);
    expect(guest.events?.some((e) => e.type === "death" && e.card === "golem"))
      .toBe(true);
    const first = children[0];
    first.hp = 1;
    knight.x = first.x;
    knight.y = first.y - 0.5;
    const before = knight.hp;
    damage(game, first, 1);
    expect(knight.hp).toBe(before - Math.round(rules.golemite.death.damage * 1.1 ** 5));
    expect(children[1].hp).toBe(CARD_MAP.golemite.hp);
    expect(game.events.filter((e) => e.type === "death" && e.card === "golemite"))
      .toHaveLength(1);
  });
});
